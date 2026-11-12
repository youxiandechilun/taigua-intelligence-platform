// 中文导读：既有验证代码：fixed_speech_test 的输入、输出及边界场景。
package aicall

import (
	"bytes"
	"encoding/binary"
	"testing"

	"taigua/sip-bridge/internal/media"
	"taigua/sip-bridge/internal/provider"
)

type fixedCancellationModel struct {
	*cancellationModel
	cancelled string
}

func (m *fixedCancellationModel) CancelFixedSpeech(id string) { m.cancelled = id }

func TestFixedSpeechFailureStopsAudioWithoutTruncatingModel(t *testing.T) {
	s, leg, base := playbackTestSession()
	model := &fixedCancellationModel{cancellationModel: base}
	s.model = model
	id := "fixed-speech-fixture"
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, PlaybackID: id, RecordingKey: provider.FixedFollowUpRecordingKey})
	queueTestAudio(s, 2)
	s.handleModelEvent(provider.Event{Type: provider.EventTypeInterrupted, PlaybackID: id, RecordingKey: provider.FixedFollowUpRecordingKey, Status: "fixed_synthesis_failed", InterruptedBy: provider.InterruptReasonSystem})
	if leg.Pending() != 0 || model.cancelled != id || len(base.reports) != 0 {
		t.Fatal("failed local speech was not stopped or truncated model history")
	}
	select {
	case e := <-s.events:
		if e.Type != EventTypeTurnDone || !e.IsInterrupted || e.Status != "fixed_synthesis_failed" {
			t.Fatalf("failure was reported as complete: %+v", e)
		}
	default:
		t.Fatal("failure was not reported")
	}
}

type fixedAudioLeg struct {
	*transcriptLeg
	frames [][]byte
}

func (l *fixedAudioLeg) Send(frame []byte) bool {
	l.frames = append(l.frames, append([]byte(nil), frame...))
	return l.transcriptLeg.Send(frame)
}

func TestFixedSpeechUsesGeneratedOutputLevel(t *testing.T) {
	output := func(playbackID, recordingKey string) []byte {
		s, baseLeg, _ := playbackTestSession()
		leg := &fixedAudioLeg{transcriptLeg: baseLeg}
		s.leg = leg
		var err error
		s.downlink, err = media.NewConverter(media.PCM16Format(8000), media.G711Format(media.LawAlaw))
		if err != nil {
			t.Fatal(err)
		}
		s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, PlaybackID: playbackID, RecordingKey: recordingKey})
		pcm := make([]byte, 320)
		for i := 0; i < len(pcm); i += 2 {
			binary.LittleEndian.PutUint16(pcm[i:], 1000)
		}
		s.playAudio(pcm)
		if len(leg.frames) != 1 {
			t.Fatalf("got %d output frames, want one", len(leg.frames))
		}
		return leg.frames[0]
	}
	generated := output("", "")
	fixed := output("fixed", provider.FixedFollowUpRecordingKey)
	recording := output("recorded", "opening-recordings")
	if !bytes.Equal(generated, fixed) || bytes.Equal(fixed, recording) {
		t.Fatal("fixed speech did not use the generated speech output level")
	}
}

type fixedTailModel struct {
	*cancellationModel
	interruptedID string
}

func (m *fixedTailModel) ActiveRecording() string { return provider.FixedFollowUpRecordingKey }
func (m *fixedTailModel) InterruptRecording(id string, _ provider.InterruptReason, _ int) error {
	m.interruptedID = id
	return nil
}
func (*fixedTailModel) PausedRecording() string          { return "" }
func (*fixedTailModel) ResumeRecording() (string, error) { return "", nil }
func (*fixedTailModel) DiscardRecording()                {}
func (*fixedTailModel) RecordingPlayed(string)           {}

func TestFixedSpeechPlaybackTailYieldsToCustomer(t *testing.T) {
	s, leg, base := playbackTestSession()
	model := &fixedTailModel{cancellationModel: base}
	s.model = model
	id := "fixed-speech-tail"
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseStarted, PlaybackID: id, RecordingKey: provider.FixedFollowUpRecordingKey})
	queueTestAudio(s, 2)
	s.handleModelEvent(provider.Event{Type: provider.EventTypeResponseDone, PlaybackID: id, RecordingKey: provider.FixedFollowUpRecordingKey})
	s.bargeIn(provider.InterruptReasonSpeech)
	if leg.Pending() != 0 || model.interruptedID != id || len(base.reports) != 0 {
		t.Fatal("customer speech did not stop the local playback tail")
	}
}
