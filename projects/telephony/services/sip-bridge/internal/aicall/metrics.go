// SPDX-License-Identifier: Apache-2.0
// Taigua adaptation: extracted for the existing workspace-scoped sales system.

// 中文导读：AI 通话会话：metrics.go。供 SIP 语音桥中的相关模块调用。
package aicall

import (
	"log/slog"
	"time"

	"taigua/sip-bridge/internal/obs"
	"taigua/sip-bridge/internal/provider"
)

// The caller's wait per turn — the number the latency budget lives or dies
// on — is measured here and published through obs.RecordTurnLatency, which
// owns the instrument (aicc_turn_latency_ms) with every other metric name.

// turnTimer follows one turn from the caller falling silent to the reply
// reaching the wire. All fields are guarded by the session's own mutex.
type turnTimer struct {
	customerTurn uint64
	// speechStoppedAt is zero when no measurement is in flight. The greeting
	// and cue-prompted turns have no caller speech, so they are not measured.
	speechStoppedAt time.Time
	// firstAudioMs is the provider's share: speech stopped to first delta.
	firstAudioMs   int64
	firstAudioSeen bool
}

// onSpeechStopped starts a measurement.
func (t *turnTimer) onSpeechStopped() {
	t.speechStoppedAt = time.Now()
	t.firstAudioMs = 0
	t.firstAudioSeen = false
}

// onSpeechStarted abandons it: the caller resumed before any reply.
func (t *turnTimer) onSpeechStarted() { t.speechStoppedAt = time.Time{} }

// onFirstAudio records the provider's share of the wait.
func (t *turnTimer) onFirstAudio() {
	if !t.speechStoppedAt.IsZero() && !t.firstAudioSeen {
		t.firstAudioMs = time.Since(t.speechStoppedAt).Milliseconds()
		t.firstAudioSeen = true
	}
}

// TurnLatencySnapshot measures customer speech-stopped to the first audio
// frame queued on the local bridge. It does not measure customer playback
// or separately attribute ASR, model reasoning, and synthesis.
type TurnLatencySnapshot struct {
	Samples        int64  `json:"samples"`
	LastTotalMs    int64  `json:"lastTotalMs"`
	LastProviderMs *int64 `json:"lastProviderMs"`
	MaxTotalMs     int64  `json:"maxTotalMs"`
}

func (s *Session) TurnLatency() *TurnLatencySnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.turnLatency.Samples == 0 {
		return nil
	}
	snapshot := s.turnLatency
	if snapshot.LastProviderMs != nil {
		ms := *snapshot.LastProviderMs
		snapshot.LastProviderMs = &ms
	}
	return &snapshot
}

// onFirstFrame closes the measurement, reporting totals; ok is false when no
// measurement was in flight.
func (t *turnTimer) onFirstFrame() (totalMs, providerMs int64, ok bool) {
	if t.speechStoppedAt.IsZero() {
		return 0, 0, false
	}
	totalMs = time.Since(t.speechStoppedAt).Milliseconds()
	providerMs = t.firstAudioMs
	t.speechStoppedAt = time.Time{}
	return totalMs, providerMs, true
}

// recordTurnLatency publishes one turn's numbers to the histogram and the log.
// The log line is what makes a single phone call analysable from logs/ alone.
func recordTurnLatency(log *slog.Logger, providerName string, totalMs, providerMs int64) {
	obs.RecordTurnLatency(providerName, totalMs)
	obs.RecordProviderFirstAudio(providerName, providerMs)
	log.Info("turn latency",
		"totalMs", totalMs, "providerMs", providerMs, "provider", providerName)
}

const actionGraceCap = 10 * time.Second

// Only local media CPU time is attributed here. Network/provider processing
// remains in provider observations rather than being labelled pure inference.
type mediaPhaseTiming struct {
	firstAudioAt   time.Time
	firstFrameSeen bool
	processingTime time.Duration
	conversionTime time.Duration
	chunks         int
}

type toolTiming struct {
	name      string
	trace     provider.ResponseTrace
	startedAt time.Time
}

func (s *Session) toolStarted(event provider.Event) {
	now := time.Now()
	s.mu.Lock()
	if s.toolTimings == nil {
		s.toolTimings = make(map[string]toolTiming)
	}
	if len(s.toolTimings) >= 16 {
		for id := range s.toolTimings {
			delete(s.toolTimings, id)
			break
		}
	}
	s.toolTimings[event.ToolCallID] = toolTiming{name: event.ToolName, trace: event.Trace, startedAt: now}
	s.mu.Unlock()
	s.log.Info("voice phase", append(event.Trace.LogAttrs(), "phase", "tool_call_received", "stageAt", now.UTC(), "toolCallId", event.ToolCallID, "toolName", event.ToolName)...)
}

func (s *Session) toolResultWritten(id string, started time.Time, err error) {
	now := time.Now()
	s.mu.Lock()
	t, ok := s.toolTimings[id]
	delete(s.toolTimings, id)
	s.mu.Unlock()
	attrs := t.trace.LogAttrs()
	attrs = append(attrs, "phase", "tool_result_written", "stageAt", now.UTC(), "toolCallId", id,
		"toolName", t.name, "writeMs", now.Sub(started).Milliseconds(), "success", err == nil)
	if ok {
		attrs = append(attrs, "toolWaitAndExecutionMs", now.Sub(t.startedAt).Milliseconds())
	}
	s.log.Info("voice phase", attrs...)
}
