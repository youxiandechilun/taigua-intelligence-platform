// 中文导读：既有验证代码：实时模型连接、事件转换与对话请求管理。
package provider

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"taigua/sip-bridge/internal/provider/wsconn"
)

func testWire(t *testing.T) (*Realtime, <-chan map[string]any) {
	t.Helper()
	messages := make(chan map[string]any, 20)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, req, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			_, b, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var v map[string]any
			if json.Unmarshal(b, &v) == nil {
				messages <- v
			}
		}
	}))
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	conn, err := wsconn.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil, log)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(); server.Close() })
	return &Realtime{trafficCtx: context.Background(), profile: StepFunProfile(), conn: conn, log: log, cfg: SessionConfig{Language: "zh"}, instructions: "业务规则", events: make(chan Event, 20)}, messages
}
func nextWire(t *testing.T, m <-chan map[string]any) map[string]any {
	t.Helper()
	select {
	case v := <-m:
		return v
	case <-time.After(time.Second):
		t.Fatal("no protocol message")
		return nil
	}
}
func TestStepDirectedPromptIsTransient(t *testing.T) {
	r, m := testWire(t)
	if err := r.SpeakText("刚才没听清，您方便再说一下吗？", false); err != nil {
		t.Fatal(err)
	}
	item := nextWire(t, m)
	request := nextWire(t, m)
	if item["type"] != "conversation.item.create" || request["type"] != "response.create" {
		t.Fatal("directed prompt must precede generation")
	}
	instructions := request["response"].(map[string]any)["instructions"].(string)
	if !strings.Contains(instructions, "意群") || !strings.Contains(instructions, "问句柔和") || !strings.HasSuffix(instructions, "刚才没听清，您方便再说一下吗？") {
		t.Fatal("fixed line lost expressive delivery or exact script")
	}
	id := item["item"].(map[string]any)["id"]
	r.removeOpeningCue()
	deletion := nextWire(t, m)
	if deletion["type"] != "conversation.item.delete" || deletion["item_id"] != id {
		t.Fatal("temporary prompt remained in customer history")
	}
}
func TestExactLineKeepsDeliveryAndWordsAcrossLanguages(t *testing.T) {
	for _, tc := range []struct{ language, text, delivery string }{
		{"zh-CN", "您好，我是阳阳，晚上19点方便吗？", "亲切、温和、有感情"},
		{"zh-HK", "你好，請問現在方便嗎？", "意群"},
		{"zh-CN", "理解的，您先忙，好吗？", "本句是在体谅对方"},
		{"zh-CN", "可以呀，那我整理一下。", "本句是在爽快回应"},
		{"en", "Hello, is seven o'clock convenient?", "meaningful emphasis"},
	} {
		got := SayExactly(tc.text, tc.language)
		if !strings.Contains(got, tc.delivery) || !strings.HasSuffix(got, "\n"+tc.text) {
			t.Fatalf("%s lost delivery or exact wording", tc.language)
		}
	}
}
func TestHeldToolResultDoesNotCreateAnotherResponse(t *testing.T) {
	r, m := testWire(t)
	r.HoldReply()
	if err := r.SendToolResult("call_1", `{"saved":false}`, "听完客户再答"); err != nil {
		t.Fatal(err)
	}
	if nextWire(t, m)["type"] != "conversation.item.create" {
		t.Fatal("tool result was not returned")
	}
	select {
	case extra := <-m:
		t.Fatalf("held result started a reply: %v", extra)
	case <-time.After(40 * time.Millisecond):
	}
	r.ReleaseReply()
	if err := r.GuideReply("回应最新完整答复"); err != nil {
		t.Fatal(err)
	}
	if nextWire(t, m)["type"] != "conversation.item.create" || nextWire(t, m)["type"] != "response.create" {
		t.Fatal("explicit resume did not start one directed reply")
	}
}
func TestFailedTranscriptRemainsUnknown(t *testing.T) {
	r, _ := testWire(t)
	r.handle(&wireEvent{Type: "conversation.item.input_audio_transcription.failed"})
	e := <-r.events
	if e.Type != EventTypeInputTranscript || !e.IsFinal || e.Text != "" {
		t.Fatal("recognition failure was turned into a customer answer")
	}
}

func TestQwenOmniConnectsVoiceAndCustomerTranscription(t *testing.T) {
	for _, model := range []string{"qwen3.8-omni-flash-realtime", "qwen3.5-omni-plus-realtime", "qwen3.5-omni-flash-realtime"} {
		t.Run(model, func(t *testing.T) {
			p := QwenProfile()
			p.Model = model
			r := &Realtime{profile: p}
			session := r.buildSessionUpdate(SessionConfig{Instructions: "业务话术", Voice: "ceo-clone"}, false)["session"].(map[string]any)
			if session["input_audio_transcription"].(map[string]any)["model"] != "qwen3-asr-flash-realtime" {
				t.Fatal("customer transcript must be enabled for intent recognition")
			}
			voice := session["voice"]
			if strings.HasPrefix(model, "qwen3.8-") {
				voice = session["audio"].(map[string]any)["output"].(map[string]any)["voice"]
			}
			if voice != "ceo-clone" || session["instructions"] != "业务话术" {
				t.Fatal("saved voice and business instructions must reach the provider session")
			}
		})
	}
}

func TestToolAcknowledgementDoesNotRepeatFarewell(t *testing.T) {
	for _, open := range []bool{false, true} {
		r, messages := testWire(t)
		r.isResponseOpen.Store(open)
		ack, ok := any(r).(interface{ AcknowledgeTool(string, string) error })
		if !ok {
			t.Fatal("silent tool acknowledgement unavailable")
		}
		if err := ack.AcknowledgeTool("end_1", `{"saved":true}`); err != nil {
			t.Fatal(err)
		}
		item := nextWire(t, messages)
		if item["item"].(map[string]any)["type"] != "function_call_output" {
			t.Fatal("missing tool receipt")
		}
		r.isResponseOpen.Store(false)
		r.releaseOwedTurn()
		select {
		case extra := <-messages:
			t.Fatalf("ack created a duplicate goodbye: %v", extra)
		case <-time.After(30 * time.Millisecond):
		}
	}
}
