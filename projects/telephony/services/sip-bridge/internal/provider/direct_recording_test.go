// 中文导读：既有验证代码：把客户完整问句与已配置问法匹配；唯一命中才直播放音，未命中或音频不可用时回退模型。
package provider

import (
	"context"
	"errors"
	"strings"
	"taigua/sip-bridge/internal/media"
	"testing"
	"time"
)

func directFixture(t *testing.T, loader RecordingLoader) (*Recorded, *Realtime, <-chan map[string]any, Recording) {
	t.Helper()
	base, wire := testWire(t)
	base.profile = QwenProfile()
	base.profile.Model = "qwen3.8-omni-flash-realtime"
	base.manualReplies = true
	base.timing.customerSequence = 1
	clip, wav := fixtureRecording(1)
	clip.Key = "faq:price"
	clip.Trigger = "直播收费吗"
	clip.Phrases = []string{"这个收费吗"}
	clip.Direct = true
	if loader == nil {
		loader = func(context.Context, Recording) ([]byte, error) { return wav, nil }
	}
	r := WithRecordings(base, []Recording{clip}, "attempt", loader)
	r.ctx, r.cancel = context.WithCancel(context.Background())
	r.format = media.PCM16Format(24000)
	t.Cleanup(func() { r.cancel(); r.cancelPlayback(false); r.writers.Wait() })
	return r, base, wire, clip
}
func assertNoCreate(t *testing.T, wire <-chan map[string]any) {
	t.Helper()
	end := time.After(60 * time.Millisecond)
	for {
		select {
		case m := <-wire:
			if m["type"] == "response.create" {
				t.Fatal("recording started model inference")
			}
		case <-end:
			return
		}
	}
}
func TestDirectRecordingMatchedSkipsInferenceAndTTS(t *testing.T) {
	r, _, wire, _ := directFixture(t, nil)
	if !r.ResolveDirectReply("这个收费吗？", ResponseTrace{CustomerTurn: 1}) {
		t.Fatal("not handled")
	}
	deadline := time.After(time.Second)
	for {
		select {
		case e := <-r.events:
			if e.Type == EventTypeAudioDelta {
				assertNoCreate(t, wire)
				return
			}
		case <-deadline:
			t.Fatal("no recorded audio")
		}
	}
}
func TestDirectRecordingFallbackAndDedupe(t *testing.T) {
	for _, kind := range []string{"miss", "ambiguous", "unready", "read-failed", "timeout", "checksum"} {
		t.Run(kind, func(t *testing.T) {
			var loader RecordingLoader
			if kind == "read-failed" {
				loader = func(context.Context, Recording) ([]byte, error) { return nil, errors.New("unavailable") }
			}
			if kind == "timeout" {
				loader = func(ctx context.Context, _ Recording) ([]byte, error) { <-ctx.Done(); return nil, ctx.Err() }
			}
			r, _, wire, clip := directFixture(t, loader)
			text := "这个收费吗"
			switch kind {
			case "miss":
				text = "课程什么时候开始"
			case "ambiguous":
				other := clip
				other.Key = "faq:second"
				other.AssetID = ""
				r.clips = append(r.clips, other)
			case "unready":
				r.clips[0].AssetID = ""
			case "checksum":
				r.clips[0].SHA256 = strings.Repeat("0", 64)
			}
			for i := 0; i < 3; i++ {
				if !r.ResolveDirectReply(text, ResponseTrace{CustomerTurn: 1}) {
					t.Fatal("not handled")
				}
			}
			n := 0
			end := time.After(2 * time.Second)
			for n == 0 {
				select {
				case m := <-wire:
					if m["type"] == "response.create" {
						n++
					}
				case <-end:
					t.Fatal("no model fallback")
				}
			}
			assertNoCreate(t, wire)
			select {
			case e := <-r.events:
				if e.Type == EventTypeAudioDelta {
					t.Fatal("bad asset played")
				}
			default:
			}
		})
	}
}
func TestDirectRecordingContinuationSupersedesSlowRead(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	_, wav := fixtureRecording(1)
	r, base, wire, _ := directFixture(t, func(ctx context.Context, _ Recording) ([]byte, error) {
		close(started)
		select {
		case <-release:
			return wav, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	r.ResolveDirectReply("这个收费吗", ResponseTrace{CustomerTurn: 1})
	<-started
	base.mu.Lock()
	base.timing.customerSequence = 2
	base.isCallerSpeaking = true
	base.mu.Unlock()
	close(release)
	r.writers.Wait()
	assertNoCreate(t, wire)
	select {
	case e := <-r.events:
		t.Fatalf("stale reply emitted %v", e.Type)
	default:
	}
}
func TestDirectRecordingFinalBeforeSpeechStopWaits(t *testing.T) {
	r, base, wire, _ := directFixture(t, nil)
	base.mu.Lock()
	base.isCallerSpeaking = true
	base.mu.Unlock()
	r.ResolveDirectReply("这个收费吗", ResponseTrace{CustomerTurn: 1})
	select {
	case <-r.events:
		t.Fatal("answered into caller speech")
	case <-time.After(40 * time.Millisecond):
	}
	base.mu.Lock()
	base.isCallerSpeaking = false
	base.mu.Unlock()
	select {
	case e := <-r.events:
		if e.Type != EventTypeResponseStarted {
			t.Fatal(e.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("stopped speech not resolved")
	}
	assertNoCreate(t, wire)
}
func TestDirectRecordingHoldCancelsPendingLookup(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	_, wav := fixtureRecording(1)
	r, _, wire, _ := directFixture(t, func(ctx context.Context, _ Recording) ([]byte, error) {
		close(started)
		select {
		case <-release:
			return wav, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	})
	r.ResolveDirectReply("这个收费吗", ResponseTrace{CustomerTurn: 1})
	<-started
	r.HoldReply()
	close(release)
	r.writers.Wait()
	assertNoCreate(t, wire)
	select {
	case e := <-r.events:
		t.Fatalf("held reply emitted %v", e.Type)
	default:
	}
}
func TestDirectRecordingConservativeConfiguredQuestions(t *testing.T) {
	clip := Recording{Key: "faq:one", Direct: true, Trigger: "这个收费吗", Phrases: []string{"多少钱"}, AssetID: "a", SHA256: strings.Repeat("f", 64)}
	for _, tc := range []struct {
		text  string
		match bool
	}{{"这个收费吗？", true}, {"多少钱", true}, {"这个收费吗？在哪里上课", false}, {"我不想了解收费了", false}, {"哦", false}} {
		got, _ := matchDirectRecording(tc.text, []Recording{clip})
		if (got != nil) != tc.match {
			t.Fatal(tc.text)
		}
	}
}
func TestDirectRecordingPayloadRetainsVADAndOpeningRules(t *testing.T) {
	p := QwenProfile()
	p.Model = "qwen3.8-omni-flash-realtime"
	p.SemanticTurnType, p.SemanticTurnSilenceMs = "semantic_vad_ec", 0
	r := &Realtime{profile: p}
	cfg := SessionConfig{ManualReplies: true, Turn: TurnDetection{Mode: TurnModeSemantic, SilenceMs: 200, Threshold: .5}}
	d := r.buildSessionUpdate(cfg, false)["session"].(map[string]any)["turn_detection"].(map[string]any)
	if d["create_response"] != false || d["silence_duration_ms"] != 200 {
		t.Fatal(d)
	}
	d = r.buildSessionUpdate(SessionConfig{Turn: cfg.Turn}, false)["session"].(map[string]any)["turn_detection"].(map[string]any)
	if _, ok := d["create_response"]; ok {
		t.Fatal("ordinary calls changed")
	}
}
