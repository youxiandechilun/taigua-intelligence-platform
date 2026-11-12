// 中文导读：既有验证代码：fixed_speech_test 的输入、输出及边界场景。
package provider

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type fixedSpeechBase struct {
	*synthesisTestBase
	mu         sync.Mutex
	busy, held bool
	speakCalls int
}

func (b *fixedSpeechBase) HoldReplyIfIdle() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.busy || b.held {
		return false
	}
	b.held = true
	return true
}
func (b *fixedSpeechBase) ReleaseReply() { b.mu.Lock(); b.held = false; b.mu.Unlock() }
func (b *fixedSpeechBase) SpeakText(string, bool) error {
	b.mu.Lock()
	b.speakCalls++
	b.mu.Unlock()
	return nil
}
func (b *fixedSpeechBase) state() (bool, int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.held, b.speakCalls
}

func fixedSpeechHarness(t *testing.T, worker func(*CosySession, *synthesisTurn)) (*CosySession, *fixedSpeechBase) {
	t.Helper()
	b := &fixedSpeechBase{synthesisTestBase: &synthesisTestBase{stream: make(chan Event, 32)}}
	s := WithSpeechSynthesis(b, SpeechSynthesis{Model: t.Name(), Rate: 1}, "", slog.New(slog.NewTextHandler(io.Discard, nil)))
	s.ctx, s.cancel = context.WithCancel(context.Background())
	s.synthesisWorker = func(turn *synthesisTurn) { worker(s, turn) }
	go s.forward()
	t.Cleanup(func() {
		s.cancel()
		deadline := time.After(time.Second)
		for {
			select {
			case _, ok := <-s.events:
				if !ok {
					return
				}
			case <-deadline:
				t.Error("fixed speech worker did not stop")
				return
			}
		}
	})
	return s, b
}

func fixedEvent(t *testing.T, s *CosySession, kind EventType) Event {
	t.Helper()
	select {
	case e := <-s.events:
		if e.Type != kind {
			t.Fatalf("event = %s, want %s", e.Type, kind)
		}
		return e
	case <-time.After(time.Second):
		t.Fatalf("missing event %s", kind)
		return Event{}
	}
}

func TestFixedFollowUpUsesSelectedSynthesizerAndPlaybackReceipt(t *testing.T) {
	words := make(chan string, 1)
	s, b := fixedSpeechHarness(t, func(s *CosySession, turn *synthesisTurn) {
		var text strings.Builder
		for part := range turn.input {
			text.WriteString(part)
		}
		words <- text.String()
		s.packet(turn, synthesisPacket{audio: []byte{1, 2, 3, 4}})
		s.packet(turn, synthesisPacket{done: true})
	})
	started, err := s.SpeakFixed("再见。")
	if err != nil || !started {
		t.Fatalf("fixed speech not started: %v", err)
	}
	start := fixedEvent(t, s, EventTypeResponseStarted)
	transcript := fixedEvent(t, s, EventTypeOutputTranscript)
	audio := fixedEvent(t, s, EventTypeAudioDelta)
	end := fixedEvent(t, s, EventTypeResponseDone)
	if start.PlaybackID == "" || start.RecordingKey != FixedFollowUpRecordingKey || transcript.PlaybackID != start.PlaybackID || audio.PlaybackID != start.PlaybackID || end.PlaybackID != start.PlaybackID || transcript.Text != "再见。" || !transcript.IsFinal || len(audio.Audio) == 0 {
		t.Fatal("local transcript, audio and completion must share a playback identity")
	}
	if got := <-words; got != "再见。" {
		t.Fatalf("unexpected synthesized text: %s", got)
	}
	if held, calls := b.state(); !held || calls != 0 || s.ActiveRecording() != FixedFollowUpRecordingKey {
		t.Fatal("model was called or floor was released before audio drained")
	}
	s.RecordingPlayed(start.PlaybackID)
	if held, calls := b.state(); held || calls != 0 || s.ActiveRecording() != "" {
		t.Fatal("playback completion did not release the floor")
	}
}

func TestFixedFollowUpDoesNotTakeBusyFloor(t *testing.T) {
	s, b := fixedSpeechHarness(t, func(*CosySession, *synthesisTurn) { t.Error("busy floor started synthesis") })
	b.mu.Lock()
	b.busy = true
	b.mu.Unlock()
	started, err := s.SpeakFixed("再见。")
	if err != nil || started {
		t.Fatal("fixed speech pre-empted a busy conversation")
	}
	select {
	case e := <-s.events:
		t.Fatalf("busy floor emitted an event: %s", e.Type)
	default:
	}
}

func TestFixedFollowUpCancelsWhenCustomerInterrupts(t *testing.T) {
	entered, cancelled := make(chan struct{}), make(chan struct{})
	s, b := fixedSpeechHarness(t, func(s *CosySession, turn *synthesisTurn) {
		close(entered)
		<-turn.ctx.Done()
		s.packets <- synthesisPacket{epoch: turn.epoch, audio: []byte{9, 9}}
		close(cancelled)
	})
	if started, err := s.SpeakFixed("再见。"); err != nil || !started {
		t.Fatal("fixed speech not started")
	}
	start := fixedEvent(t, s, EventTypeResponseStarted)
	fixedEvent(t, s, EventTypeOutputTranscript)
	<-entered
	if err := s.InterruptRecording(start.PlaybackID, InterruptReasonSpeech, 0); err != nil {
		t.Fatal(err)
	}
	interrupted := fixedEvent(t, s, EventTypeInterrupted)
	if interrupted.PlaybackID != start.PlaybackID || interrupted.RecordingKey != FixedFollowUpRecordingKey {
		t.Fatal("interruption lost the local turn identity")
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("synthesis did not cancel")
	}
	if held, _ := b.state(); held || s.ActiveRecording() != "" {
		t.Fatal("customer interruption did not release the floor")
	}
}

func TestFixedFollowUpSynthesisFailureIsNotPlaybackCompletion(t *testing.T) {
	s, b := fixedSpeechHarness(t, func(s *CosySession, turn *synthesisTurn) {
		s.packet(turn, synthesisPacket{audio: []byte{1, 2}})
		s.packet(turn, synthesisPacket{err: errors.New("offline fixture failure")})
	})
	if started, err := s.SpeakFixed("再见。"); err != nil || !started {
		t.Fatal("fixed speech not started")
	}
	start := fixedEvent(t, s, EventTypeResponseStarted)
	fixedEvent(t, s, EventTypeOutputTranscript)
	fixedEvent(t, s, EventTypeAudioDelta)
	interrupted := fixedEvent(t, s, EventTypeInterrupted)
	if interrupted.Status != "fixed_synthesis_failed" || interrupted.PlaybackID != start.PlaybackID {
		t.Fatal("failed synthesis was reported as complete")
	}
	s.CancelFixedSpeech(start.PlaybackID)
	if held, _ := b.state(); held {
		t.Fatal("failed synthesis kept the floor held")
	}
}

func TestFixedFollowUpRespectsRealtimeFloor(t *testing.T) {
	for _, busy := range []func(*Realtime){
		func(r *Realtime) { r.isCallerSpeaking = true },
		func(r *Realtime) { r.isReplyHeld = true },
		func(r *Realtime) { r.isResponseOpen.Store(true) },
		func(r *Realtime) { r.isResponseRequested = true },
		func(r *Realtime) { r.isAutomaticReplyPending = true },
		func(r *Realtime) { r.isTurnOwed = true },
	} {
		r := &Realtime{}
		busy(r)
		if r.HoldReplyIfIdle() {
			t.Fatal("busy realtime floor was reserved")
		}
	}
	r := &Realtime{}
	if !r.HoldReplyIfIdle() || r.HoldReplyIfIdle() {
		t.Fatal("idle floor was not reserved exactly once")
	}
	r.ReleaseReply()
	if !r.HoldReplyIfIdle() {
		t.Fatal("released floor remained held")
	}
}

func TestFixedFollowUpRespectsRecordedFloor(t *testing.T) {
	for name, busy := range map[string]func(*Recorded){
		"stopped":     func(r *Recorded) { r.stopped = true },
		"playing":     func(r *Recorded) { r.active = &playback{} },
		"pending":     func(r *Recorded) { r.pending = &Recording{} },
		"held":        func(r *Recorded) { r.modelHeld = true },
		"remote open": func(r *Recorded) { r.remoteOpen = true },
	} {
		t.Run(name, func(t *testing.T) {
			r := WithRecordings(&Realtime{}, nil, "", nil)
			busy(r)
			if r.HoldReplyIfIdle() {
				t.Fatal("fixed speech reserved a busy recorded floor")
			}
		})
	}
	r := WithRecordings(&Realtime{}, nil, "", nil)
	if !r.HoldReplyIfIdle() || r.HoldReplyIfIdle() {
		t.Fatal("idle recorded floor was not reserved exactly once")
	}
	r.ReleaseReply()
	if !r.HoldReplyIfIdle() {
		t.Fatal("recorded floor remained held after playback")
	}
	r.ReleaseReply()
}

func TestFixedFollowUpSupersededByNewResponse(t *testing.T) {
	entered, oldPacketSent := make(chan struct{}), make(chan struct{})
	s, b := fixedSpeechHarness(t, func(s *CosySession, turn *synthesisTurn) {
		close(entered)
		<-turn.ctx.Done()
		s.packets <- synthesisPacket{epoch: turn.epoch, audio: []byte{9, 9}}
		close(oldPacketSent)
	})
	if started, err := s.SpeakFixed("再见。"); err != nil || !started {
		t.Fatal("fixed speech not started")
	}
	start := fixedEvent(t, s, EventTypeResponseStarted)
	fixedEvent(t, s, EventTypeOutputTranscript)
	<-entered
	b.stream <- Event{Type: EventTypeResponseStarted}
	interrupted := fixedEvent(t, s, EventTypeInterrupted)
	if interrupted.PlaybackID != start.PlaybackID {
		t.Fatal("superseded local speech lost its playback identity")
	}
	fixedEvent(t, s, EventTypeResponseStarted)
	<-oldPacketSent
	if held, _ := b.state(); held || s.ActiveRecording() != "" {
		t.Fatal("superseded local speech kept the floor")
	}
	b.stream <- Event{Type: EventTypeOutputTranscript, Text: "继续"}
	if event := fixedEvent(t, s, EventTypeOutputTranscript); event.Text != "继续" || event.PlaybackID != "" {
		t.Fatal("late local audio leaked into the new response")
	}
}

func TestFixedFollowUpRealSynthesisProtocol(t *testing.T) {
	for _, withAudio := range []bool{true, false} {
		t.Run(map[bool]string{true: "audio", false: "empty"}[withAudio], func(t *testing.T) {
			requests := make(chan map[string]any, 4)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer conn.Close()
				for {
					var request map[string]any
					if conn.ReadJSON(&request) != nil {
						return
					}
					requests <- request
					header, _ := request["header"].(map[string]any)
					switch header["action"] {
					case "run-task":
						_ = conn.WriteJSON(map[string]any{"header": map[string]any{"event": "task-started"}})
					case "finish-task":
						if withAudio {
							_ = conn.WriteMessage(websocket.BinaryMessage, []byte{0, 1, 0, 1})
						}
						_ = conn.WriteJSON(map[string]any{"header": map[string]any{"event": "task-finished"}})
					}
				}
			}))
			t.Cleanup(server.Close)
			b := &fixedSpeechBase{synthesisTestBase: &synthesisTestBase{stream: make(chan Event, 32)}}
			seed := 42
			cfg := SpeechSynthesis{Model: "local-fixed-fixture-" + t.Name(), Voice: "selected-voice", Rate: 1.1, Pitch: 0.9, Volume: 70, Instruction: "natural", Seed: &seed}
			s := WithSpeechSynthesis(b, cfg, "", slog.New(slog.NewTextHandler(io.Discard, nil)))
			s.ctx, s.cancel = context.WithCancel(context.Background())
			s.synthesisEndpoint = "ws" + strings.TrimPrefix(server.URL, "http")
			go s.forward()
			t.Cleanup(func() {
				s.cancel()
				for range s.events {
				}
			})
			if started, err := s.SpeakFixed("再见。"); err != nil || !started {
				t.Fatal("fixed speech did not start")
			}
			start := fixedEvent(t, s, EventTypeResponseStarted)
			fixedEvent(t, s, EventTypeOutputTranscript)
			if withAudio {
				fixedEvent(t, s, EventTypeAudioDelta)
				fixedEvent(t, s, EventTypeResponseDone)
				s.RecordingPlayed(start.PlaybackID)
			} else {
				if e := fixedEvent(t, s, EventTypeInterrupted); e.Status != "fixed_synthesis_failed" {
					t.Fatal("empty audio was treated as a completed farewell")
				}
				s.CancelFixedSpeech(start.PlaybackID)
			}
			for _, action := range []string{"run-task", "continue-task", "finish-task"} {
				select {
				case request := <-requests:
					header := request["header"].(map[string]any)
					if header["action"] != action {
						t.Fatalf("got action %v, want %s", header["action"], action)
					}
					payload := request["payload"].(map[string]any)
					if action == "run-task" {
						params := payload["parameters"].(map[string]any)
						if payload["model"] != cfg.Model || params["voice"] != cfg.Voice || params["rate"] != cfg.Rate || params["pitch"] != cfg.Pitch || params["volume"] != float64(cfg.Volume) || params["instruction"] != cfg.Instruction || params["seed"] != float64(seed) {
							t.Fatal("selected voice settings were not sent to synthesis")
						}
					}
					if action == "continue-task" && payload["input"].(map[string]any)["text"] != "再见。" {
						t.Fatal("unexpected text sent to synthesis")
					}
				case <-time.After(time.Second):
					t.Fatalf("missing synthesis action %s", action)
				}
			}
			if held, calls := b.state(); held || calls != 0 {
				t.Fatal("local synthesis did not release the floor or requested the model")
			}
		})
	}
}
