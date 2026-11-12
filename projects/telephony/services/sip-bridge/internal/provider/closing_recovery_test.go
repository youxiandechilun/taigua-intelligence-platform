// 中文导读：既有验证代码：closing_recovery_test 的输入、输出及边界场景。
package provider

import (
	"strings"
	"testing"
	"time"
)

func (b *fixedSpeechBase) HoldReply() error {
	b.mu.Lock()
	b.held = true
	b.mu.Unlock()
	return nil
}

func TestClosingTakesBusyFloorAndIgnoresLateProviderEvents(t *testing.T) {
	release := make(chan struct{})
	s, b := fixedSpeechHarness(t, func(s *CosySession, turn *synthesisTurn) {
		var text strings.Builder
		for part := range turn.input {
			text.WriteString(part)
		}
		if text.String() != "再见。" {
			t.Error("configured closing text was changed")
		}
		select {
		case <-release:
			s.packet(turn, synthesisPacket{audio: []byte{1, 2, 3, 4}})
			s.packet(turn, synthesisPacket{done: true})
		case <-turn.ctx.Done():
		}
	})
	b.mu.Lock()
	b.busy = true
	b.mu.Unlock()
	if err := s.SpeakClosing("再见。", "closing-fixture"); err != nil {
		t.Fatal(err)
	}
	start := fixedEvent(t, s, EventTypeResponseStarted)
	fixedEvent(t, s, EventTypeOutputTranscript)
	for _, kind := range []EventType{EventTypeResponseStarted, EventTypeOutputTranscript, EventTypeAudioDelta, EventTypeInterrupted, EventTypeResponseDone} {
		b.stream <- Event{Type: kind, Text: "旧回复", Trace: ResponseTrace{ResponseEpoch: 18, ResponseID: "old"}}
	}
	// Queue order is deliberately adversarial: late provider events may be
	// handled on either side of the first local synthesized audio packet.
	close(release)
	audio := fixedEvent(t, s, EventTypeAudioDelta)
	end := fixedEvent(t, s, EventTypeResponseDone)
	if start.PlaybackID != "closing-fixture" || audio.PlaybackID != start.PlaybackID || end.PlaybackID != start.PlaybackID {
		t.Fatal("late response stole local closing identity")
	}
	s.RecordingPlayed(start.PlaybackID)
	if held, calls := b.state(); !held || calls != 0 {
		t.Fatal("closing requested another LLM turn or released the ending hold")
	}
	select {
	case e := <-s.events:
		t.Fatalf("provider output escaped after closing: %+v", e)
	case <-time.After(15 * time.Millisecond):
	}
}

func TestRejectedDirectedClosingRetainsPayloadUntilProviderAcknowledges(t *testing.T) {
	r, wire := testWire(t)
	r.ready = make(chan struct{})
	r.finishStart(nil)
	r.profile.NeedsDirectedLineInConversation = false
	r.profile.Name = "fixture"
	r.dog = NewWatchdog(WatchdogConfig{})
	if err := r.SpeakText("再见。", true); err != nil {
		t.Fatal(err)
	}
	nextWire(t, wire)
	seq := r.responseRequestSeq
	r.handleError(&wireEvent{Error: &wireError{Message: "Conversation already has an active response", EventID: r.responseRequestEventID}})
	if !r.isResponseConflict || r.pendingSpeak != "再见。" || !r.isPendingSpeakClosing {
		t.Fatal("asynchronous rejection lost the configured closing")
	}
	r.onResponseCreated("provider-busy")
	if nextWire(t, wire)["type"] != "response.cancel" {
		t.Fatal("observed busy response was not cancelled before retry")
	}
	r.handleResponseDone(&wireEvent{Response: &wireResponse{ID: "provider-busy", Status: "cancelled"}})
	if nextWire(t, wire)["type"] != "response.create" || !r.isResponseRequested || r.responseRequestSeq <= seq || r.responseRequestText != "再见。" {
		t.Fatal("cancel acknowledgement did not retry the retained directed line")
	}
	// Only an observed response.done releases this busy floor. A stale
	// timeout cannot release a newer request, and a local closing hold is safe.
	r.HoldReply()
	r.releaseUnreconciledConflict(seq)
	if !r.isResponseRequested {
		t.Fatal("a held closing manufactured an idle provider floor")
	}
}
