// 中文导读：模型与语音供应商适配：latency.go。供 SIP 语音桥中的相关模块调用。
package provider

import "time"

// ResponseTrace is local to one VoiceSession. It contains no customer text or
// credentials. Wrappers preserve it when replacing model audio with TTS audio.
type ResponseTrace struct {
	CustomerTurn      uint64
	ResponseEpoch     uint64
	ResponseID        string
	ProviderSessionID string
	ProviderRequestID string
}

func (t ResponseTrace) LogAttrs() []any {
	return []any{"customerTurn", t.CustomerTurn, "responseEpoch", t.ResponseEpoch, "providerResponseId", t.ResponseID,
		"providerSessionId", t.ProviderSessionID, "realtimeRequestId", t.ProviderRequestID}
}

func (t ResponseTrace) SameResponse(other ResponseTrace) bool {
	if t.ProviderSessionID != "" && other.ProviderSessionID != "" && t.ProviderSessionID != other.ProviderSessionID {
		return false
	}
	if t.ResponseEpoch != 0 && other.ResponseEpoch != 0 {
		return t.ResponseEpoch == other.ResponseEpoch
	}
	return t.ResponseID == "" || other.ResponseID == "" || t.ResponseID == other.ResponseID
}

type customerTiming struct {
	sequence           uint64
	stoppedAt, finalAt time.Time
}

type responseCancellation struct {
	eventID string
	epoch   uint64
	sentAt  time.Time
}

type realtimeTiming struct {
	customerSequence uint64
	latest           *customerTiming
	inputs           map[string]*customerTiming
	inputOrder       []string
	responseCustomer *customerTiming
	trace            ResponseTrace
	requestedAt      time.Time
	createdAt        time.Time
	firstTextSeen    bool
}

// These intervals are client observations. The realtime service does not
// expose a pure inference timer or the physical end of the customer's voice.
func observedInterval(start, end time.Time) any {
	if start.IsZero() || end.IsZero() || end.Before(start) {
		return nil
	}
	return end.Sub(start).Milliseconds()
}

func (r *Realtime) observeSpeech(event *wireEvent, started bool) ResponseTrace {
	now := time.Now()
	r.mu.Lock()
	t := r.timing.inputs[event.ItemID]
	if event.ItemID == "" && (!started || r.isCallerSpeaking) {
		t = r.timing.latest
	}
	duplicate := t != nil
	if t == nil {
		r.timing.customerSequence++
		t = &customerTiming{sequence: r.timing.customerSequence}
		r.timing.latest = t
		if event.ItemID != "" {
			if r.timing.inputs == nil {
				r.timing.inputs = make(map[string]*customerTiming)
			}
			r.timing.inputs[event.ItemID] = t
			r.timing.inputOrder = append(r.timing.inputOrder, event.ItemID)
			for len(r.timing.inputOrder) > 8 {
				delete(r.timing.inputs, r.timing.inputOrder[0])
				r.timing.inputOrder = r.timing.inputOrder[1:]
			}
		}
	}
	phase := "speech_stopped_observed"
	if started {
		phase = "speech_started_observed"
	} else {
		duplicate = !t.stoppedAt.IsZero()
		if !duplicate {
			t.stoppedAt = now
		}
	}
	trace := ResponseTrace{CustomerTurn: t.sequence}
	wait := r.cfg.Turn.SilenceMs
	r.mu.Unlock()
	r.log.Info("voice phase", "phase", phase, "stageAt", now.UTC(),
		"customerTurn", trace.CustomerTurn, "inputItemId", event.ItemID,
		"vadConfiguredWaitMs", wait, "audioStartMs", event.AudioStartMs, "audioEndMs", event.AudioEndMs, "duplicate", duplicate)
	return trace
}

func (r *Realtime) observeTranscript(event *wireEvent) ResponseTrace {
	now := time.Now()
	failed := event.Type == "conversation.item.input_audio_transcription.failed"
	r.mu.Lock()
	t, exact := r.timing.inputs[event.ItemID]
	if event.ItemID == "" {
		t = r.timing.latest
	}
	if t == nil && r.manualReplies {
		r.timing.customerSequence++
		t = &customerTiming{sequence: r.timing.customerSequence}
		r.timing.latest = t
		if event.ItemID != "" {
			if r.timing.inputs == nil {
				r.timing.inputs = make(map[string]*customerTiming)
			}
			r.timing.inputs[event.ItemID] = t
			r.timing.inputOrder = append(r.timing.inputOrder, event.ItemID)
			for len(r.timing.inputOrder) > 8 {
				delete(r.timing.inputs, r.timing.inputOrder[0])
				r.timing.inputOrder = r.timing.inputOrder[1:]
			}
		}
	}
	trace := ResponseTrace{}
	var wait any
	if t != nil {
		if !failed && t.finalAt.IsZero() {
			t.finalAt = now
		}
		trace.CustomerTurn = t.sequence
		wait = observedInterval(t.stoppedAt, now)
	}
	r.mu.Unlock()
	phase, interval := "asr_final_observed", "speechStoppedToAsrFinalMs"
	if failed {
		phase, interval = "asr_failed_observed", "speechStoppedToAsrFailureMs"
	}
	r.log.Info("voice phase", "phase", phase, "stageAt", now.UTC(),
		"customerTurn", trace.CustomerTurn, "inputItemId", event.ItemID,
		"exactInputAssociation", exact, interval, wait, "failed", failed)
	return trace
}

func (r *Realtime) observeFirstText(text string) {
	if text == "" {
		return
	}
	now := time.Now()
	r.mu.Lock()
	if r.timing.firstTextSeen {
		r.mu.Unlock()
		return
	}
	r.timing.firstTextSeen = true
	attrs := r.timing.trace.LogAttrs()
	attrs = append(attrs, "phase", "model_first_text_observed", "stageAt", now.UTC(),
		"responseCreatedToFirstTextMs", observedInterval(r.timing.createdAt, now))
	if c := r.timing.responseCustomer; c != nil {
		attrs = append(attrs, "speechStoppedToFirstTextMs", observedInterval(c.stoppedAt, now),
			"asrFinalToFirstTextMs", observedInterval(c.finalAt, now))
	}
	r.mu.Unlock()
	r.log.Info("voice phase", attrs...)
}
