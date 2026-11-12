// 中文导读：模型与语音供应商适配：answering_monitor.go。供 SIP 语音桥中的相关模块调用。
package provider

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"taigua/sip-bridge/internal/media"
)

// AnsweringMonitor transcribes only the initial inbound audio independently of
// semantic turn filtering. It never requests a model response or emits audio.
// Its bounded queue and fail-open lifetime cannot stall the conversation.
type AnsweringMonitor struct {
	frames      chan []byte
	texts       chan string
	ctx         context.Context
	cancel      context.CancelFunc
	once        sync.Once
	reasonMu    sync.Mutex
	closeReason string
}

func (r *Realtime) NewAnsweringMonitor(ctx context.Context) *AnsweringMonitor {
	if r.profile.Name != "qwen" || !(strings.HasPrefix(r.profile.Model, "qwen3.8-omni-") || strings.HasPrefix(r.profile.Model, "qwen3.5-omni-")) {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 24*time.Second)
	m := &AnsweringMonitor{frames: make(chan []byte, 1000), texts: make(chan string, 16), ctx: ctx, cancel: cancel}
	go m.run(r)
	return m
}
func (m *AnsweringMonitor) Close() { m.stop("call_or_monitor_closed") }
func (m *AnsweringMonitor) stop(reason string) {
	if m != nil {
		m.once.Do(func() {
			m.reasonMu.Lock()
			m.closeReason = reason
			m.reasonMu.Unlock()
			m.cancel()
		})
	}
}
func (m *AnsweringMonitor) Texts() <-chan string {
	if m == nil {
		return nil
	}
	return m.texts
}
func (m *AnsweringMonitor) Push(pcm []byte, format media.AudioFormat) {
	if m == nil {
		return
	}
	select {
	case <-m.ctx.Done():
		return
	default:
	}
	if format != media.PCM16Format(16000) {
		m.stop("unsupported_audio_format")
		return
	}
	select {
	case m.frames <- append([]byte(nil), pcm...):
	default:
		m.stop("audio_queue_full")
	}
}
func monitorSpeech(pcm []byte) bool {
	active := 0
	for i := 0; i+1 < len(pcm); i += 2 {
		v := int(int16(binary.LittleEndian.Uint16(pcm[i:])))
		if v > 250 || v < -250 {
			active++
		}
	}
	return active >= 1600 // At least 100 ms of above-silence samples per block.
}

type monitorEvent struct {
	Type       string     `json:"type"`
	Delta      string     `json:"delta"`
	Text       string     `json:"text"`
	Transcript string     `json:"transcript"`
	Usage      *wireUsage `json:"usage"`
	EventID    string     `json:"event_id"`
	RequestID  string     `json:"request_id"`
	Session    struct {
		ID string `json:"id"`
	} `json:"session"`
	Error struct {
		Code      string `json:"code"`
		RequestID string `json:"request_id"`
	} `json:"error"`
}

func (m *AnsweringMonitor) run(r *Realtime) {
	defer m.Close()
	// Wait for enough actual inbound audio; never delay or gate the greeting.
	const chunkBytes = 2 * 16000 * 2
	block := make([]byte, 0, chunkBytes)
	var first []byte
	audioBytes := 0
	for first == nil {
		select {
		case <-m.ctx.Done():
			return
		case frame := <-m.frames:
			audioBytes += len(frame)
			block = append(block, frame...)
			if len(block) >= chunkBytes {
				if monitorSpeech(block) {
					first = block
				}
				block = make([]byte, 0, chunkBytes)
			}
			if audioBytes >= 18*16000*2 && first == nil {
				return
			}
		}
	}
	endpoint, err := url.Parse(r.profile.Endpoint)
	if err != nil {
		return
	}
	q := endpoint.Query()
	q.Set("model", r.profile.Model)
	endpoint.RawQuery = q.Encode()
	header := http.Header{"Authorization": []string{"Bearer " + r.apiKey}}
	dialer := websocket.Dialer{HandshakeTimeout: 4 * time.Second}
	conn, response, err := dialer.DialContext(m.ctx, endpoint.String(), header)
	if err != nil {
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		if m.ctx.Err() != nil {
			return
		}
		r.log.Warn("answering monitor unavailable; normal call preserved")
		return
	}
	providerRequestID, providerSessionID := "", ""
	if response != nil {
		providerRequestID = providerUpgradeRequestID(response.Header)
	}
	r.log.Info("answering monitor connected", "providerRequestId", providerRequestID)
	conn.SetReadLimit(1 << 20)
	events := make(chan monitorEvent, 64)
	readerStop, readerDone := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(readerDone)
		defer close(events)
		for {
			var e monitorEvent
			if conn.ReadJSON(&e) != nil {
				r.log.Debug("answering monitor connection closed")
				return
			}
			select {
			case events <- e:
			case <-readerStop:
				return
			}
		}
	}()
	send := func(v any) bool {
		conn.SetWriteDeadline(time.Now().Add(250 * time.Millisecond))
		return conn.WriteJSON(v) == nil
	}
	ready, inflight := false, false
	shutdownReason := "observation_finished"
	queue := [][]byte{first}
	allText, partial := "", ""
	previousBlock := ""
	requestID := uuid.NewString()
	sequence := 0
	// One observation per committed block, even when the provider omits tokens.
	usageOpen := false
	var usage *wireUsage
	observe := func() {
		if usageOpen {
			r.observeUsage(&wireResponse{ID: "answering:" + requestID + ":" + string(rune('0'+sequence)), Usage: usage})
			usageOpen = false
			usage = nil
		}
	}
	defer observe()
	defer func() {
		// The monitor already runs independently of the phone actor. Stop all
		// new commits, but allow an outstanding transcription a short terminal
		// grace period instead of aborting its socket immediately on hangup.
		terminalReceived := !inflight
		drainOutcome := "not_needed"
		if inflight {
			timer := time.NewTimer(500 * time.Millisecond)
		drain:
			for {
				select {
				case e, ok := <-events:
					if !ok {
						drainOutcome = "connection_closed"
						break drain
					}
					if e.RequestID != "" {
						providerRequestID = e.RequestID
					}
					if e.Error.RequestID != "" {
						providerRequestID = e.Error.RequestID
					}
					if e.Session.ID != "" {
						providerSessionID = e.Session.ID
					}
					if e.Usage != nil {
						usage = e.Usage
					}
					if e.Type == "conversation.item.input_audio_transcription.completed" || e.Type == "conversation.item.input_audio_transcription.failed" || e.Type == "error" {
						terminalReceived = true
						drainOutcome = "terminal_received"
						break drain
					}
				case <-timer.C:
					drainOutcome = "deadline"
					break drain
				}
			}
			timer.Stop()
		}
		close(readerStop)
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(100*time.Millisecond))
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-readerDone:
		case <-timer.C:
		}
		timer.Stop()
		_ = conn.Close()
		m.reasonMu.Lock()
		reason := m.closeReason
		m.reasonMu.Unlock()
		if reason == "" {
			if m.ctx.Err() == context.DeadlineExceeded {
				reason = "observation_deadline"
			} else if m.ctx.Err() != nil {
				reason = "parent_context_closed"
			} else {
				reason = shutdownReason
			}
		}
		r.log.Info("answering monitor closed", "providerRequestId", providerRequestID, "providerSessionId", providerSessionID,
			"monitorCorrelationId", requestID, "closeReason", reason, "terminalReceived", terminalReceived, "pendingTranscription", inflight, "drainOutcome", drainOutcome)
	}()
	publish := func(text string) {
		if len([]rune(text)) > 500 {
			return
		}
		select {
		case m.texts <- text:
		case <-m.ctx.Done():
		}
	}
	for {
		if ready && !inflight && len(queue) > 0 {
			pcm := queue[0]
			queue = queue[1:]
			if m.ctx.Err() != nil {
				return
			}
			if !send(map[string]any{"type": "input_audio_buffer.append", "audio": base64.StdEncoding.EncodeToString(pcm)}) {
				shutdownReason = "write_failed"
				return
			}
			if m.ctx.Err() != nil {
				return
			}
			sequence++
			usageOpen = true
			inflight = true
			if !send(map[string]any{"type": "input_audio_buffer.commit"}) {
				shutdownReason = "write_failed"
				return
			}
		}
		if audioBytes >= 18*16000*2 && !inflight && len(queue) == 0 {
			shutdownReason = "observation_limit"
			return
		}
		select {
		case <-m.ctx.Done():
			return
		case frame := <-m.frames:
			if audioBytes >= 18*16000*2 {
				continue
			}
			audioBytes += len(frame)
			block = append(block, frame...)
			if len(block) >= chunkBytes {
				if monitorSpeech(block) {
					queue = append(queue, block)
				}
				block = make([]byte, 0, chunkBytes)
			}
		case e, ok := <-events:
			if !ok {
				shutdownReason = "provider_connection_closed"
				return
			}
			if e.RequestID != "" {
				providerRequestID = e.RequestID
			}
			if e.Error.RequestID != "" {
				providerRequestID = e.Error.RequestID
			}
			if e.Session.ID != "" {
				providerSessionID = e.Session.ID
			}
			if e.Usage != nil {
				usage = e.Usage
			}
			switch e.Type {
			case "session.created":
				cfg := map[string]any{"modalities": []string{"text"}, "turn_detection": nil, "input_audio_transcription": map[string]any{"model": "qwen3-asr-flash-realtime"}, "audio": map[string]any{"input": map[string]any{"format": map[string]any{"type": "pcm", "sample_rate": 16000}}, "output": map[string]any{"voice": r.profile.Voice, "format": map[string]any{"type": "pcm", "sample_rate": 24000}}}}
				if !send(map[string]any{"type": "session.update", "session": cfg}) {
					shutdownReason = "write_failed"
					return
				}
			case "session.updated":
				ready = true
				r.log.Info("answering monitor ready", "providerRequestId", providerRequestID, "providerSessionId", providerSessionID, "monitorCorrelationId", requestID)
			case "conversation.item.input_audio_transcription.delta":
				partial = monitorPartial(partial, e)
				publish(partial)
				publish(previousBlock + partial)
				publish(allText + partial)
			case "conversation.item.input_audio_transcription.completed":
				observe()
				r.log.Info("answering monitor transcript received", "characters", len([]rune(e.Transcript)))
				// Also inspect this block on its own: an unrelated ASR prefix
				// must not prevent a later explicit voicemail announcement.
				publish(e.Transcript)
				publish(previousBlock + e.Transcript)
				previousBlock = e.Transcript
				allText += e.Transcript
				if runes := []rune(allText); len(runes) > 400 {
					allText = string(runes[len(runes)-400:])
				}
				partial = ""
				publish(allText)
				inflight = false
			case "conversation.item.input_audio_transcription.failed", "error":
				inflight = false
				shutdownReason = "provider_error"
				r.log.Warn("answering monitor transcription unavailable; normal call preserved", "providerRequestId", providerRequestID, "providerSessionId", providerSessionID, "providerEventId", e.EventID, "providerErrorCode", e.Error.Code)
				return
			case "response.created", "response.audio.delta": // Unexpected generation must never reach the caller.
				shutdownReason = "unexpected_generation"
				r.log.Warn("answering monitor produced unexpected response; monitor stopped")
				return
			}
		}
	}
}

// Omni transcription deltas carry a cumulative confirmed text field. Legacy
// streams send incremental delta instead. Tentative stash text is never terminal.
func monitorPartial(prior string, e monitorEvent) string {
	if e.Text != "" {
		return e.Text
	}
	return prior + e.Delta
}
