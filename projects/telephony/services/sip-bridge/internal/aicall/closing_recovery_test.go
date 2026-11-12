// 中文导读：既有验证代码：closing_recovery_test 的输入、输出及边界场景。
package aicall

import (
	"taigua/sip-bridge/internal/provider"
	"testing"
)

type closingPlaybackModel struct {
	*cancellationModel
	s  *Session
	id string
}

func (m *closingPlaybackModel) SpeakClosing(_ string, id string) error {
	m.id = id
	// An automatic response was already in flight when the call ended.
	m.s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, Trace: provider.ResponseTrace{ResponseEpoch: 2}})
	m.s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, PlaybackID: id, RecordingKey: provider.FixedFollowUpRecordingKey})
	return nil
}

func TestClosingOwnsPlaybackAcrossLateStartsAndCancellations(t *testing.T) {
	s, leg, base := playbackTestSession()
	m := &closingPlaybackModel{cancellationModel: base, s: s}
	s.model = m
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, Trace: provider.ResponseTrace{ResponseEpoch: 1}})
	s.SealAfterTurn(1) // The former response had already consumed this ceiling.
	if err := s.Speak("再见。", true); err != nil {
		t.Fatal(err)
	}
	turn := s.CurrentTurn()
	if turn != 2 || !s.ClosingPlaybackMatches(turn) || s.ClosingPlaybackMatches(1) {
		t.Fatal("old response consumed or matched the committed farewell")
	}
	queueTestAudio(s, 3)
	for _, kind := range []provider.EventType{provider.EventTypeResponseStarted, provider.EventTypeInterrupted, provider.EventTypeResponseDone} {
		s.handleModelEvent(provider.Event{Type: kind, Trace: provider.ResponseTrace{ResponseEpoch: 2}})
	}
	if leg.Pending() != 3 || s.CurrentTurn() != turn || !s.HasOutput() {
		t.Fatal("late provider lifecycle truncated the farewell")
	}
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseDone, PlaybackID: m.id, RecordingKey: provider.FixedFollowUpRecordingKey})
	marker := <-s.playbackDone
	if marker.turn != turn || !marker.hasAudio || marker.playbackID != m.id {
		t.Fatal("farewell did not reach its own playback-drain marker")
	}
}

func TestOpeningPlaybackCannotCompleteCustomerReplyLatency(t *testing.T) {
	s, _, _ := playbackTestSession()
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, PlaybackID: "opening", RecordingKey: "opening-recordings"})
	s.timer.onSpeechStopped()
	s.timer.customerTurn = 4
	queueTestAudio(s, 1)
	if s.turnLatency.Samples != 0 {
		t.Fatal("continuing opening was counted as a response to customer speech")
	}
}
