// 中文导读：既有验证代码：session_test 的输入、输出及边界场景。
package aicall

import (
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"taigua/sip-bridge/internal/media"
	"taigua/sip-bridge/internal/provider"
)

// Only the playback boundary is faked; the real queue and interruption
// accounting are exercised without placing calls or using a cloud model.
type transcriptLeg struct {
	Leg
	mu      sync.Mutex
	pending int
}

func (l *transcriptLeg) Pending() int     { l.mu.Lock(); defer l.mu.Unlock(); return l.pending }
func (l *transcriptLeg) Send([]byte) bool { l.mu.Lock(); defer l.mu.Unlock(); l.pending++; return true }
func (l *transcriptLeg) ClearTx() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := l.pending
	l.pending = 0
	return n
}
func (l *transcriptLeg) drain() { l.mu.Lock(); l.pending = 0; l.mu.Unlock() }

func TestRejectedDraftAudioEvidenceSurvivesInterruption(t *testing.T) {
	leg := &transcriptLeg{}
	s := &Session{leg: leg, framer: newFramer(media.LawAlaw), log: slog.New(slog.NewTextHandler(io.Discard, nil)), isFirstAudioRecorded: true}
	s.beginTurn()
	first := s.CurrentTurn()
	if s.QueuedAudioForTurn(first) {
		t.Fatal("text-only draft claims queued audio")
	}
	s.mu.Lock()
	s.queueFrame(make([]byte, 160))
	s.mu.Unlock()
	s.stopPlayback(true)
	if !s.QueuedAudioForTurn(first) {
		t.Fatal("interruption erased evidence of possible playback")
	}
	s.beginTurn()
	if s.QueuedAudioForTurn(s.CurrentTurn()) {
		t.Fatal("prior turn contaminated silent new draft")
	}
	if !s.QueuedAudioForTurn(first) {
		t.Fatal("late older transcript was treated as definitely unheard")
	}
	other := &Session{}
	other.beginTurn()
	if other.QueuedAudioForTurn(other.CurrentTurn()) {
		t.Fatal("audio evidence leaked to another call")
	}
}

// The provider is a boundary fake. No network, SIP calls or cloud requests are
// made; turn ordering, audio accounting and playback watching stay real.
type cancellationModel struct {
	provider.VoiceSession
	reports []int
}

func (m *cancellationModel) Interrupt(_ provider.InterruptReason, playedMs int) error {
	m.reports = append(m.reports, playedMs)
	return nil
}

func playbackTestSession() (*Session, *transcriptLeg, *cancellationModel) {
	leg := &transcriptLeg{}
	model := &cancellationModel{}
	s := &Session{leg: leg, model: model, framer: newFramer(media.LawAlaw),
		log: slog.New(slog.NewTextHandler(io.Discard, nil)), isFirstAudioRecorded: true,
		events: make(chan Event, 16), playbackDone: make(chan playbackMarker, 8), done: make(chan struct{}),
		cfg: Config{NoInput: -1}}
	return s, leg, model
}
func queueTestAudio(s *Session, frames int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := 0; i < frames; i++ {
		s.queueFrame(make([]byte, 160))
	}
}
func assertNoCallEvent(t *testing.T, s *Session) {
	t.Helper()
	select {
	case e := <-s.events:
		t.Fatalf("unexpected event for current response: %+v", e)
	default:
	}
}
func TestLatePriorCancellationPreservesCurrentReply(t *testing.T) {
	s, leg, model := playbackTestSession()
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
	queueTestAudio(s, 2)
	turn := s.CurrentTurn()
	s.handleModelEvent(provider.Event{Type: provider.EventTypeInterrupted, Status: "cancelled", InterruptedBy: provider.InterruptReasonSystem})
	if leg.Pending() != 2 {
		t.Fatal("old cancellation discarded current response audio")
	}
	if len(model.reports) != 0 {
		t.Fatal("old cancellation truncated the current model response")
	}
	if !s.HasOutput() || s.CurrentTurn() != turn {
		t.Fatal("old cancellation ended the current response")
	}
	assertNoCallEvent(t, s)
}
func TestCurrentCancellationStillStopsReply(t *testing.T) {
	s, leg, model := playbackTestSession()
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
	queueTestAudio(s, 2)
	s.handleModelEvent(provider.Event{Type: provider.EventTypeInterrupted, Status: "cancelled", InterruptedBy: provider.InterruptReasonSpeech})
	if leg.Pending() != 0 || s.HasOutput() {
		t.Fatal("current cancellation left audio or generation active")
	}
	if len(model.reports) != 1 || model.reports[0] != 0 {
		t.Fatal("current cancellation did not report the unheard queued audio")
	}
	select {
	case e := <-s.events:
		if e.Type != EventTypeTurnDone || e.Turn != 1 || !e.IsInterrupted {
			t.Fatalf("incorrect current cancellation event: %+v", e)
		}
	default:
		t.Fatal("current cancellation was not reported")
	}
}
func TestDifferentRecordingCancellationCannotStopCurrentPlayback(t *testing.T) {
	s, leg, model := playbackTestSession()
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, PlaybackID: "current-recording"})
	queueTestAudio(s, 2)
	s.handleModelEvent(provider.Event{Type: provider.EventTypeInterrupted, PlaybackID: "older-recording", InterruptedBy: provider.InterruptReasonSystem})
	if leg.Pending() != 2 || !s.HasOutput() || len(model.reports) != 0 {
		t.Fatal("older recording interrupted current playback")
	}
	assertNoCallEvent(t, s)
}
func TestLateCancellationConcurrentSessionIsolation(t *testing.T) {
	for i := 0; i < 60; i++ {
		t.Run(fmt.Sprintf("session-%d", i), func(t *testing.T) {
			t.Parallel()
			s, leg, model := playbackTestSession()
			s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
			s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
			frames := 1 + i%4
			queueTestAudio(s, frames)
			s.handleModelEvent(provider.Event{Type: provider.EventTypeInterrupted, InterruptedBy: provider.InterruptReasonSystem})
			if leg.Pending() != frames || len(model.reports) != 0 || !s.HasOutput() {
				t.Fatal("late cancellation damaged an independent session")
			}
			assertNoCallEvent(t, s)
		})
	}
}
func TestPlaybackReceiptWaitsForCurrentAudioDrain(t *testing.T) {
	s, leg, _ := playbackTestSession()
	s.wg.Add(1)
	go s.watchPlayback()
	t.Cleanup(func() { close(s.done); s.wg.Wait() })
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
	queueTestAudio(s, 2)
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseDone, Status: "completed"})
	select {
	case e := <-s.events:
		if e.Type != EventTypeTurnDone || e.IsInterrupted {
			t.Fatalf("wrong generation receipt: %+v", e)
		}
	case <-time.After(time.Second):
		t.Fatal("generation completion missing")
	}
	select {
	case e := <-s.events:
		t.Fatalf("playback claimed before queue drained: %+v", e)
	case <-time.After(40 * time.Millisecond):
	}
	leg.drain()
	select {
	case e := <-s.events:
		if e.Type != EventTypePlaybackDone || e.Turn != 1 || !e.HasAudio {
			t.Fatalf("wrong playback receipt: %+v", e)
		}
	case <-time.After(time.Second):
		t.Fatal("playback completion missing after queue drained")
	}
}

func (*cancellationModel) HoldReply() error        { return nil }
func (*cancellationModel) GuideReply(string) error { return nil }
func (*cancellationModel) ReleaseReply()           {}

func TestSystemHoldReportsUnheardSpokenDraftAsZero(t *testing.T) {
	s, _, model := playbackTestSession()
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
	s.handleModelEvent(provider.Event{Type: provider.EventTypeOutputTranscript, Text: "I will send it to you.", IsFinal: true})
	if err := s.HoldReply(); err != nil {
		t.Fatal(err)
	}
	if len(model.reports) != 1 || model.reports[0] != 0 {
		t.Fatalf("unheard spoken draft not reported as zero: %v", model.reports)
	}
}
func TestSystemHoldPreservesToolAndAlreadySpokenSemantics(t *testing.T) {
	t.Run("tool-only", func(t *testing.T) {
		s, _, model := playbackTestSession()
		s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
		s.handleModelEvent(provider.Event{Type: provider.EventTypeToolCall, ToolCallID: "tool-only", ToolName: "lookup"})
		if err := s.HoldReply(); err != nil {
			t.Fatal(err)
		}
		if len(model.reports) != 1 || model.reports[0] != -1 {
			t.Fatalf("tool-only turn received an invented zero speech trim: %v", model.reports)
		}
	})
	t.Run("already-spoken", func(t *testing.T) {
		s, leg, model := playbackTestSession()
		s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
		s.handleModelEvent(provider.Event{Type: provider.EventTypeOutputTranscript, Text: "Hello.", IsFinal: true})
		queueTestAudio(s, 2)
		leg.drain()
		if err := s.HoldReply(); err != nil {
			t.Fatal(err)
		}
		if len(model.reports) != 1 || model.reports[0] != 40 {
			t.Fatalf("system hold erased the already sent speech: %v", model.reports)
		}
	})
	t.Run("new-tool-turn", func(t *testing.T) {
		s, _, model := playbackTestSession()
		s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
		s.handleModelEvent(provider.Event{Type: provider.EventTypeOutputTranscript, Text: "Prior response.", IsFinal: true})
		s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
		if err := s.HoldReply(); err != nil {
			t.Fatal(err)
		}
		if len(model.reports) != 1 || model.reports[0] != -1 {
			t.Fatalf("prior response text contaminated the next turn: %v", model.reports)
		}
	})
	t.Run("whitespace-is-not-speech", func(t *testing.T) {
		s, _, model := playbackTestSession()
		s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted})
		s.handleModelEvent(provider.Event{Type: provider.EventTypeOutputTranscript, Text: " \n\t", IsFinal: true})
		if err := s.HoldReply(); err != nil {
			t.Fatal(err)
		}
		if len(model.reports) != 1 || model.reports[0] != -1 {
			t.Fatalf("whitespace was treated as a spoken draft: %v", model.reports)
		}
	})
}

type recordingCancellationModel struct {
	*cancellationModel
	recordingID string
	recordingMs int
}

func (m *recordingCancellationModel) InterruptRecording(id string, _ provider.InterruptReason, ms int) error {
	m.recordingID, m.recordingMs = id, ms
	return nil
}
func (*recordingCancellationModel) PausedRecording() string          { return "" }
func (*recordingCancellationModel) ResumeRecording() (string, error) { return "", nil }
func (*recordingCancellationModel) DiscardRecording()                {}
func (*recordingCancellationModel) RecordingPlayed(string)           {}
func TestSystemHoldKeepsRecordingPlaybackIdentity(t *testing.T) {
	s, leg, base := playbackTestSession()
	recorder := &recordingCancellationModel{cancellationModel: base}
	s.model = recorder
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, PlaybackID: "original-opening"})
	s.handleModelEvent(provider.Event{Type: provider.EventTypeOutputTranscript, PlaybackID: "original-opening", Text: "Original recording.", IsFinal: true})
	queueTestAudio(s, 3)
	leg.drain()
	if err := s.HoldReply(); err != nil {
		t.Fatal(err)
	}
	if recorder.recordingID != "original-opening" || recorder.recordingMs != 60 || len(base.reports) != 0 {
		t.Fatalf("recording playback was confused with an unheard generated draft: id=%s ms=%d model=%v", recorder.recordingID, recorder.recordingMs, base.reports)
	}
}
