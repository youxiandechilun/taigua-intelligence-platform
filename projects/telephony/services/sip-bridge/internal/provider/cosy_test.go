// 中文导读：既有验证代码：复刻音色合成适配：接收文本流、分片提交 TTS、输出音频并处理取消和轮次归属。
package provider

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	syncatomic "sync/atomic"
	"testing"
	"time"
)

type synthesisTestBase struct {
	VoiceSession
	stream chan Event
}

func (b *synthesisTestBase) Events() <-chan Event { return b.stream }
func synthesisHarness(t *testing.T, worker func(*CosySession, *synthesisTurn)) (*CosySession, *synthesisTestBase) {
	t.Helper()
	base := &synthesisTestBase{stream: make(chan Event, 32)}
	s := WithSpeechSynthesis(base, SpeechSynthesis{Model: "test-clone", Rate: 1}, "", slog.New(slog.NewTextHandler(io.Discard, nil)))
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
				t.Error("synthesis actor/worker did not terminate")
				return
			}
		}
	})
	return s, base
}
func synthesisEvent(t *testing.T, s *CosySession, kind EventType) Event {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		select {
		case e, ok := <-s.events:
			if !ok {
				t.Fatal("synthesis actor closed early")
			}
			if e.Type == kind {
				return e
			}
		case <-deadline:
			t.Fatalf("missing %s", kind)
			return Event{}
		}
	}
}
func TestSynthesisConnectionStartsBeforeFirstCompletePhrase(t *testing.T) {
	entered := make(chan *synthesisTurn, 2)
	phrases := make(chan string, 2)
	var starts syncatomic.Int32
	s, b := synthesisHarness(t, func(s *CosySession, turn *synthesisTurn) {
		starts.Add(1)
		entered <- turn
		var text strings.Builder
		for {
			select {
			case part, ok := <-turn.input:
				if !ok {
					phrases <- text.String()
					s.packet(turn, synthesisPacket{audio: []byte{2, 2}})
					s.packet(turn, synthesisPacket{done: true})
					return
				}
				text.WriteString(part)
			case <-turn.ctx.Done():
				return
			}
		}
	})
	b.stream <- Event{Type: EventTypeResponseStarted}
	b.stream <- Event{Type: EventTypeOutputTranscript, Text: "您好"}
	var turn *synthesisTurn
	select {
	case turn = <-entered:
	case <-time.After(time.Second):
		t.Fatal("connection still waits for punctuation")
	}
	select {
	case phrase := <-turn.input:
		t.Fatalf("incomplete phrase reached TTS: %q", phrase)
	default:
	}
	b.stream <- Event{Type: EventTypeOutputTranscript, Text: "，我是小程。"}
	b.stream <- Event{Type: EventTypeOutputTranscript, Text: "您好，我是小程。", IsFinal: true}
	b.stream <- Event{Type: EventTypeResponseDone}
	if len(synthesisEvent(t, s, EventTypeAudioDelta).Audio) != 2 {
		t.Fatal("generated audio missing")
	}
	synthesisEvent(t, s, EventTypeResponseDone)
	select {
	case text := <-phrases:
		if text != "您好，我是小程。" {
			t.Fatalf("phrase boundaries lost text: %q", text)
		}
	case <-time.After(time.Second):
		t.Fatal("worker did not finish")
	}
	if starts.Load() != 1 {
		t.Fatal("one response opened multiple synthesis workers")
	}
}
func TestSynthesisCancelledHandshakeCannotLeakIntoNextResponse(t *testing.T) {
	entered := make(chan uint64, 2)
	cancelled := make(chan struct{})
	s, b := synthesisHarness(t, func(s *CosySession, turn *synthesisTurn) {
		entered <- turn.epoch
		if turn.epoch == 1 {
			<-turn.ctx.Done()
			s.packets <- synthesisPacket{epoch: turn.epoch, audio: []byte{1, 1}}
			s.packets <- synthesisPacket{epoch: turn.epoch, err: errors.New("late handshake error")}
			close(cancelled)
			return
		}
		for {
			select {
			case _, ok := <-turn.input:
				if !ok {
					s.packet(turn, synthesisPacket{audio: []byte{2, 2}})
					s.packet(turn, synthesisPacket{done: true})
					return
				}
			case <-turn.ctx.Done():
				return
			}
		}
	})
	b.stream <- Event{Type: EventTypeResponseStarted}
	synthesisEvent(t, s, EventTypeResponseStarted)
	b.stream <- Event{Type: EventTypeOutputTranscript, Text: "你好"}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("first handshake did not start")
	}
	b.stream <- Event{Type: EventTypeResponseStarted}
	synthesisEvent(t, s, EventTypeResponseStarted)
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("old handshake ignored cancellation")
	}
	b.stream <- Event{Type: EventTypeOutputTranscript, Text: "这是新回复。", IsFinal: true}
	b.stream <- Event{Type: EventTypeResponseDone}
	deadline := time.After(time.Second)
	gotAudio := false
	for {
		select {
		case e := <-s.events:
			if e.Type == EventTypeError {
				t.Fatal("cancelled handshake failed a newer response")
			}
			if e.Type == EventTypeAudioDelta {
				if len(e.Audio) == 0 || e.Audio[0] != 2 {
					t.Fatal("cancelled response audio leaked")
				}
				gotAudio = true
			}
			if e.Type == EventTypeResponseDone {
				if !gotAudio {
					t.Fatal("new response audio missing")
				}
				return
			}
		case <-deadline:
			t.Fatal("new response did not finish")
		}
	}
}
func TestSynthesisPendingHandshakeIsCancelledAndJoined(t *testing.T) {
	entered, finished := make(chan struct{}), make(chan struct{})
	s, b := synthesisHarness(t, func(s *CosySession, turn *synthesisTurn) { close(entered); <-turn.ctx.Done(); close(finished) })
	b.stream <- Event{Type: EventTypeResponseStarted}
	b.stream <- Event{Type: EventTypeOutputTranscript, Text: "你好"}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("handshake did not start")
	}
	s.stopSpeech()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("pending handshake did not observe cancellation")
	}
	s.cancel()
}
func TestSynthesisHandshakeFailuresAreReportedAndJoined(t *testing.T) {
	for _, name := range []string{"failure", "timeout"} {
		t.Run(name, func(t *testing.T) {
			finished := make(chan struct{})
			s, b := synthesisHarness(t, func(s *CosySession, turn *synthesisTurn) {
				defer close(finished)
				if name == "timeout" {
					deadline, cancel := context.WithTimeout(turn.ctx, 10*time.Millisecond)
					defer cancel()
					<-deadline.Done()
				}
				s.packet(turn, synthesisPacket{err: errors.New("simulated handshake " + name)})
			})
			b.stream <- Event{Type: EventTypeResponseStarted}
			b.stream <- Event{Type: EventTypeOutputTranscript, Text: "你好"}
			if !synthesisEvent(t, s, EventTypeError).IsFatal {
				t.Fatal("synthesis failure was silently swallowed")
			}
			select {
			case <-finished:
			case <-time.After(time.Second):
				t.Fatal("failed handshake worker leaked")
			}
		})
	}
}
