// 中文导读：既有验证代码：recorded_test 的输入、输出及边界场景。
package provider

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"strings"
	"taigua/sip-bridge/internal/media"
	"testing"
	"time"
)

func fixtureRecording(seconds int) (Recording, []byte) {
	wav := make([]byte, 44+32000*seconds)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:], uint32(len(wav)-8))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:], 16)
	binary.LittleEndian.PutUint16(wav[20:], 1)
	binary.LittleEndian.PutUint16(wav[22:], 1)
	binary.LittleEndian.PutUint32(wav[24:], 16000)
	binary.LittleEndian.PutUint32(wav[28:], 32000)
	binary.LittleEndian.PutUint16(wav[32:], 2)
	binary.LittleEndian.PutUint16(wav[34:], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:], uint32(len(wav)-44))
	sum := sha256.Sum256(wav)
	return Recording{Key: "opening-recordings", AssetID: "asset-one", Text: "您好，现在方便聊两句吗？", SHA256: hex.EncodeToString(sum[:])}, wav
}
func TestRecordingChecksumAndCache(t *testing.T) {
	clip, wav := fixtureRecording(1)
	calls := 0
	r := WithRecordings(nil, []Recording{clip}, "attempt", func(context.Context, Recording) ([]byte, error) { calls++; return wav, nil })
	for i := 0; i < 2; i++ {
		pcm, err := r.audio(context.Background(), clip)
		if err != nil || len(pcm) != 32000 {
			t.Fatal("verified PCM unavailable", err)
		}
	}
	if calls != 1 {
		t.Fatal("replay must use cached asset")
	}
	clip.AssetID = "altered"
	clip.SHA256 = strings.Repeat("0", 64)
	if _, err := r.audio(context.Background(), clip); err == nil {
		t.Fatal("tampered asset accepted")
	}
}
func TestRandomOpeningStablePerAttempt(t *testing.T) {
	clip, _ := fixtureRecording(1)
	other := clip
	other.AssetID = "second"
	r := WithRecordings(nil, []Recording{clip, other}, "stable-attempt", nil)
	first := r.opening().AssetID
	for i := 0; i < 100; i++ {
		if r.opening().AssetID != first {
			t.Fatal("same call changed its opening")
		}
	}
	r.clips = []Recording{other}
	if r.opening().AssetID != "second" {
		t.Fatal("fixed opening not respected")
	}
}
func TestRecordedTurnInterruptsWithoutRequestingModelSpeech(t *testing.T) {
	base, wire := testWire(t)
	clip, wav := fixtureRecording(2)
	r := WithRecordings(base, []Recording{clip}, "attempt", func(context.Context, Recording) ([]byte, error) { return wav, nil })
	r.ctx, r.cancel = context.WithCancel(context.Background())
	defer r.cancel()
	r.format = media.PCM16Format(24000)
	r.startPlayback(clip, wav[44:], "tool-call")
	// One silent tool result; no response.create is allowed for a recording.
	if nextWire(t, wire)["type"] != "conversation.item.create" {
		t.Fatal("missing tool result")
	}
	audio := 0
	deadline := time.After(time.Second)
	for audio < 2 {
		select {
		case event := <-r.events:
			if event.Type == EventTypeAudioDelta {
				audio++
			}
		case <-deadline:
			t.Fatal("recording did not play")
		}
	}
	if err := r.Interrupt(InterruptReasonSpeech, 40); err != nil {
		t.Fatal(err)
	}
	stopped := false
	for !stopped {
		select {
		case event := <-r.events:
			if event.Type == EventTypeInterrupted {
				stopped = true
			}
		case <-deadline:
			t.Fatal("recording ignored interruption")
		}
	}
	r.writers.Wait()
	note := nextWire(t, wire)
	if note["type"] != "conversation.item.create" {
		t.Fatal("missing partial playback note")
	}
	select {
	case event := <-wire:
		if event["type"] == "response.create" {
			t.Fatal("recording triggered billed synthesis")
		}
	case <-time.After(30 * time.Millisecond):
	}
}
func TestRecordingInstructionsSurviveFlowChange(t *testing.T) {
	base, wire := testWire(t)
	r := WithRecordings(base, nil, "attempt", nil)
	r.extraInstructions = "\n保持同一位真人声音"
	if err := r.UpdateInstructions("下一流程"); err != nil {
		t.Fatal(err)
	}
	message := nextWire(t, wire)
	text := message["session"].(map[string]any)["instructions"].(string)
	if !strings.Contains(text, "下一流程") || !strings.Contains(text, "同一位真人") {
		t.Fatal("voice continuity lost at next node")
	}
}

func TestRecordingDownloadCancelledByCustomerSpeech(t *testing.T) {
	base, _ := testWire(t)
	clip, _ := fixtureRecording(1)
	entered, cancelled := make(chan struct{}), make(chan struct{})
	r := WithRecordings(base, []Recording{clip}, "attempt", func(ctx context.Context, _ Recording) ([]byte, error) {
		close(entered)
		<-ctx.Done()
		close(cancelled)
		return nil, ctx.Err()
	})
	r.ctx, r.cancel = context.WithCancel(context.Background())
	defer r.cancel()
	r.format = media.PCM16Format(24000)
	go r.forward()
	r.startPlayback(clip, nil, "")
	<-entered
	base.events <- Event{Type: EventTypeSpeechStarted}
	// The telephone actor consumes speech, flushes its queue, then reports the
	// actually heard time. The provider must preserve the asset for resumption.
	var playbackID string
	for {
		e := <-r.Events()
		if e.Type == EventTypeResponseStarted {
			playbackID = e.PlaybackID
		}
		if e.Type == EventTypeSpeechStarted {
			break
		}
	}
	if playbackID == "" {
		t.Fatal("download was not announced to the telephone actor")
	}
	if err := r.InterruptRecording(playbackID, InterruptReasonSpeech, 0); err != nil {
		t.Fatal(err)
	}
	if r.PausedRecording() != clip.Key {
		t.Fatal("interrupted recording was lost")
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("speech failed to cancel pending download")
	}
	r.cancel()
	r.writers.Wait()
}
func TestFullPlaybackQueueDoesNotDeadlockCancellation(t *testing.T) {
	base, _ := testWire(t)
	clip, wav := fixtureRecording(1)
	r := WithRecordings(base, []Recording{clip}, "attempt", nil)
	r.ctx, r.cancel = context.WithCancel(context.Background())
	defer r.cancel()
	r.format = media.PCM16Format(24000)
	for i := 0; i < cap(r.events); i++ {
		r.events <- Event{Type: EventTypeAudioDelta}
	}
	r.startPlayback(clip, wav[44:], "")
	done := make(chan struct{})
	go func() { r.cancelPlayback(true); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("full output queue blocked cancellation")
	}
	r.writers.Wait()
}

func TestRecordingResumesSameAssetFromHeardPosition(t *testing.T) {
	base, _ := testWire(t)
	clip, wav := fixtureRecording(1)
	r := WithRecordings(base, []Recording{clip}, "attempt", nil)
	r.ctx, r.cancel = context.WithCancel(context.Background())
	defer r.cancel()
	r.format = media.PCM16Format(24000)
	r.startPlayback(clip, wav[44:], "")
	first := <-r.Events()
	if first.PlaybackID == "" {
		t.Fatal("missing playback identity")
	}
	if err := r.InterruptRecording(first.PlaybackID, InterruptReasonSpeech, 300); err != nil {
		t.Fatal(err)
	}
	if _, err := r.ResumeRecording(); err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	active := r.active
	id, asset, start, heard := active.id, active.clip.AssetID, active.startMs, active.heardMs
	r.mu.Unlock()
	if asset != clip.AssetID || start != 260 || heard != 300 || id == first.PlaybackID {
		t.Fatalf("wrong resume: %s %d %d", asset, start, heard)
	}
	// A delayed cancellation from the old segment cannot pause the new one.
	_ = r.InterruptRecording(first.PlaybackID, InterruptReasonSpeech, 100)
	if r.PausedRecording() != "" {
		t.Fatal("old segment paused new audio")
	}
	_ = r.InterruptRecording(id, InterruptReasonSpeech, 20)
	r.mu.Lock()
	heard = r.active.heardMs
	r.mu.Unlock()
	if heard != 300 {
		t.Fatal("repeated interruption moved cursor backwards")
	}
	r.DiscardRecording()
	if key, _ := r.ResumeRecording(); key != "" {
		t.Fatal("discarded recording resumed")
	}
	r.cancel()
	r.writers.Wait()
}
func TestRecordingStaysInterruptibleAfterGeneration(t *testing.T) {
	base, _ := testWire(t)
	clip, wav := fixtureRecording(1)
	r := WithRecordings(base, []Recording{clip}, "attempt", nil)
	r.ctx, r.cancel = context.WithCancel(context.Background())
	defer r.cancel()
	r.format = media.PCM16Format(24000)
	r.startPlayback(clip, wav[44:], "")
	id := ""
	for {
		e := <-r.Events()
		if e.Type == EventTypeResponseStarted {
			id = e.PlaybackID
		}
		if e.Type == EventTypeResponseDone {
			break
		}
	}
	_ = r.InterruptRecording(id, InterruptReasonSpeech, 700)
	if r.PausedRecording() != clip.Key {
		t.Fatal("generated but unheard tail was lost")
	}
	r.RecordingPlayed(id)
	if r.PausedRecording() != clip.Key {
		t.Fatal("late drain completed an interrupted recording")
	}
	r.cancel()
	r.writers.Wait()
}

func TestMissingOpeningRecordingWithoutTextStopsBeforeModel(t *testing.T) {
	clip, _ := fixtureRecording(1)
	r := WithRecordings(nil, []Recording{clip}, "attempt", func(context.Context, Recording) ([]byte, error) { return nil, errors.New("asset unavailable") })
	if err := r.Start(context.Background(), SessionConfig{}); err == nil || !strings.Contains(err.Error(), "without a text fallback") {
		t.Fatal("missing recording must not invent an unconfigured opening", err)
	}
}
