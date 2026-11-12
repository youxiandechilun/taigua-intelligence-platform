// 中文导读：既有验证代码：prewarm_test 的输入、输出及边界场景。
package provider

import (
	"context"
	"github.com/gorilla/websocket"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPrewarmTransportSendsNoTaskUntilTextAndClosesUnused(t *testing.T) {
	for _, mode := range []string{"speech", "tool_only", "interrupted"} {
		t.Run(mode, func(t *testing.T) {
			connected, closed := make(chan struct{}, 2), make(chan struct{}, 2)
			actions := make(chan string, 10)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				c, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer c.Close()
				defer func() { closed <- struct{}{} }()
				connected <- struct{}{}
				for {
					var m map[string]any
					if c.ReadJSON(&m) != nil {
						return
					}
					action := m["header"].(map[string]any)["action"].(string)
					actions <- action
					switch action {
					case "run-task":
						c.WriteJSON(map[string]any{"header": map[string]any{"event": "task-started"}})
					case "finish-task":
						c.WriteMessage(websocket.BinaryMessage, []byte{0, 1, 0, 1})
						c.WriteJSON(map[string]any{"header": map[string]any{"event": "task-finished"}})
					}
				}
			}))
			defer server.Close()
			b := &synthesisTestBase{stream: make(chan Event, 20)}
			s := WithSpeechSynthesis(b, SpeechSynthesis{Model: "test", Rate: 1}, "", slog.New(slog.NewTextHandler(io.Discard, nil)))
			s.ctx, s.cancel = context.WithCancel(context.Background())
			s.synthesisEndpoint = "ws" + strings.TrimPrefix(server.URL, "http")
			defer s.cancel()
			go s.forward()
			b.stream <- Event{Type: EventTypeResponseStarted}
			select {
			case <-connected:
			case <-time.After(time.Second):
				t.Fatal("transport wasn't prepared during model thinking")
			}
			select {
			case a := <-actions:
				t.Fatalf("prewarm submitted a task without text: %s", a)
			case <-time.After(30 * time.Millisecond):
			}
			switch mode {
			case "speech":
				b.stream <- Event{Type: EventTypeOutputTranscript, Text: "这场直播不收费。", IsFinal: true}
				b.stream <- Event{Type: EventTypeResponseDone}
				synthesisEvent(t, s, EventTypeAudioDelta)
				synthesisEvent(t, s, EventTypeResponseDone)
				for _, want := range []string{"run-task", "continue-task", "finish-task"} {
					select {
					case got := <-actions:
						if got != want {
							t.Fatalf("got %s want %s", got, want)
						}
					case <-time.After(time.Second):
						t.Fatal("missing synthesis action")
					}
				}
				select {
				case <-connected:
					t.Fatal("prepared connection was not reused")
				default:
				}
			case "tool_only":
				b.stream <- Event{Type: EventTypeResponseDone}
				synthesisEvent(t, s, EventTypeResponseDone)
			case "interrupted":
				b.stream <- Event{Type: EventTypeInterrupted}
				synthesisEvent(t, s, EventTypeInterrupted)
			}
			select {
			case <-closed:
			case <-time.After(time.Second):
				t.Fatal("unused/finished connection leaked")
			}
			if mode != "speech" {
				select {
				case a := <-actions:
					t.Fatalf("unused connection started task: %s", a)
				default:
				}
			}
			close(b.stream)
			for range s.events {
			}
		})
	}
}
func TestCosyForwardsSilentAcknowledgement(t *testing.T) {
	r, m := testWire(t)
	s := WithSpeechSynthesis(r, SpeechSynthesis{}, "", r.log)
	if err := s.AcknowledgeTool("end_1", `{"saved":true}`); err != nil {
		t.Fatal(err)
	}
	if nextWire(t, m)["type"] != "conversation.item.create" {
		t.Fatal("receipt lost through voice wrapper")
	}
	select {
	case e := <-m:
		t.Fatalf("wrapper requested another reply: %v", e)
	case <-time.After(30 * time.Millisecond):
	}
}
