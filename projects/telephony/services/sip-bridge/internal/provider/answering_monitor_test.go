// 中文导读：既有验证代码：answering_monitor_test 的输入、输出及边界场景。
package provider

import (
	"context"
	"encoding/binary"
	"github.com/gorilla/websocket"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"taigua/sip-bridge/internal/media"
	"testing"
	"time"
)

func TestAnsweringMonitorTranscribesDuringOpeningWithoutGeneration(t *testing.T) {
	messages := make(chan map[string]any, 20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		conn.WriteJSON(map[string]any{"type": "session.created"})
		for {
			var v map[string]any
			if conn.ReadJSON(&v) != nil {
				return
			}
			messages <- v
			switch v["type"] {
			case "session.update":
				conn.WriteJSON(map[string]any{"type": "session.updated"})
			case "input_audio_buffer.commit":
				conn.WriteJSON(map[string]any{"type": "conversation.item.input_audio_transcription.delta", "delta": "通话已转至语音留言"})
				conn.WriteJSON(map[string]any{"type": "conversation.item.input_audio_transcription.completed", "transcript": "通话已转至语音留言。"})
			}
		}
	}))
	defer server.Close()
	p := QwenProfile()
	p.Model = "qwen3.8-omni-flash-realtime"
	p.Endpoint = "ws" + strings.TrimPrefix(server.URL, "http")
	r := &Realtime{profile: p, apiKey: "test", log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	m := r.NewAnsweringMonitor(context.Background())
	defer m.Close()
	pcm := make([]byte, 3*16000*2)
	for i := 0; i < len(pcm); i += 2 {
		binary.LittleEndian.PutUint16(pcm[i:], 1000)
	}
	m.Push(pcm, media.PCM16Format(16000))
	select {
	case text := <-m.Texts():
		if !strings.Contains(text, "语音留言") {
			t.Fatal(text)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("monitor never received overlapping input")
	}
	cfg := nextWire(t, messages)
	session := cfg["session"].(map[string]any)
	if session["turn_detection"] != nil || session["modalities"].([]any)[0] != "text" {
		t.Fatal("monitor can create speech")
	}
	if nextWire(t, messages)["type"] != "input_audio_buffer.append" || nextWire(t, messages)["type"] != "input_audio_buffer.commit" {
		t.Fatal("wrong input protocol")
	}
	select {
	case unexpected := <-messages:
		t.Fatalf("unexpected generation: %v", unexpected)
	case <-time.After(30 * time.Millisecond):
	}
	m.Close()
	m.Close()
}
func TestAnsweringMonitorRejectsSilenceAndWrongFormats(t *testing.T) {
	if monitorSpeech(make([]byte, 96000)) {
		t.Fatal("silence is speech")
	}
	p := QwenProfile()
	p.Model = "qwen3.8-omni-flash-realtime"
	r := &Realtime{profile: p}
	m := r.NewAnsweringMonitor(context.Background())
	m.Push([]byte{1, 2}, media.PCM16Format(24000))
	select {
	case <-m.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("invalid format was accepted")
	}
	r.profile.Name = "stepfun"
	if r.NewAnsweringMonitor(context.Background()) != nil {
		t.Fatal("unsupported wire protocol")
	}
	var none *AnsweringMonitor
	none.Push(nil, media.PCM16Format(16000))
	none.Close()
	if none.Texts() != nil {
		t.Fatal("nil monitor not safe")
	}
}

func TestAnsweringMonitorUsesConfirmedCumulativeTextWithoutRepeatingIt(t *testing.T) {
	p := monitorPartial("", monitorEvent{Text: "已转至"})
	p = monitorPartial(p, monitorEvent{Text: "已转至语音留言"})
	if p != "已转至语音留言" {
		t.Fatalf("cumulative transcript duplicated: %s", p)
	}
	p = monitorPartial("已转至", monitorEvent{Delta: "语音留言"})
	if p != "已转至语音留言" {
		t.Fatalf("legacy delta lost: %s", p)
	}
}
