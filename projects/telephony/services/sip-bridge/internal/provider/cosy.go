// 中文导读：复刻音色合成适配：接收文本流、分片提交 TTS、输出音频并处理取消和轮次归属。
// 模型负责产生回复文本，合成器负责把文本转为选定人物的音频；两条事件流需要对齐回复标识。
// flushText 决定何时提交文本片段；合成连接、首包、分片大小和播放队列会共同影响首音等待。
// 打断时同时处理生产端取消与过期片段，避免旧轮次音频混入下一轮。
package provider

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// SpeechSynthesis is a server-owned binding to an auditioned, model-specific
// clone. It does not replace the realtime model used for recognition or tools.
type SpeechSynthesis struct {
	// WorkspaceID is supplied by the trusted bridge, never by TTS parameters.
	WorkspaceID     string  `json:"-"`
	CredentialScope string  `json:"credentialScope"`
	SourceModel     string  `json:"sourceModel"`
	SourceVoice     string  `json:"sourceVoice"`
	VoiceID         string  `json:"voiceId"`
	Model           string  `json:"model"`
	Voice           string  `json:"voice"`
	Rate            float64 `json:"rate"`
	Pitch           float64 `json:"pitch"`
	Volume          int     `json:"volume"`
	Instruction     string  `json:"instruction"`
	Seed            *int    `json:"seed,omitempty"`
}

const SpeechSynthesisFile = "/opt/taigua-sales/voice/synthesis.json"

// 中文注释：读取并校验指定作用域、模型和音色的语音合成配置。
func ConfiguredSpeechSynthesis(scope, model, voice string) (*SpeechSynthesis, error) {
	b, err := os.ReadFile(SpeechSynthesisFile)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(b) > 256*1024 {
		return nil, errors.New("voice synthesis configuration too large")
	}
	var rows []SpeechSynthesis
	if err = json.Unmarshal(b, &rows); err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.CredentialScope != scope || row.SourceModel != model || row.SourceVoice != voice {
			continue
		}
		if (row.Model != "cosyvoice-v3.5-plus" && row.Model != "qwen-audio-3.1-tts-plus") || !strings.HasPrefix(row.Voice, row.Model+"-") || row.Rate < .5 || row.Rate > 2 || row.Pitch < .5 || row.Pitch > 2 || row.Volume < 0 || row.Volume > 100 || (row.Seed != nil && (*row.Seed < 0 || *row.Seed > 2147483647)) {
			return nil, errors.New("invalid voice synthesis binding")
		}
		return &row, nil
	}
	return nil, nil
}

type synthesisPacket struct {
	epoch      uint64
	audio      []byte
	done       bool
	err        error
	characters int
}
type synthesisConnection struct {
	conn               *websocket.Conn
	requestID          string
	startedAt, readyAt time.Time
	err                error
}
type synthesisTurn struct {
	trace              ResponseTrace
	connection         <-chan synthesisConnection
	epoch              uint64
	localID            string
	ctx                context.Context
	cancel             context.CancelFunc
	input              chan string
	buffer             string
	transcript         string
	started            bool
	finished           bool
	cancelled          bool
	cancelReason       string
	baseDone           *Event
	responseStartedAt  time.Time
	firstTextAt        time.Time
	synthesisStartedAt time.Time
	firstPhraseAt      time.Time
	firstSubmittedAt   time.Time
	cacheKey           string
	cacheAudio         []byte
	cacheCapture       bool
}

const FixedFollowUpRecordingKey = "fixed-followup-farewell"

type fixedSpeechRequest struct {
	text      string
	closingID string
	result    chan bool
}

// shortSpeechCache stores only complete, short replies. The exact voice and
// delivery settings are part of the key, so a cached waveform can never be
// played for a different auditioned voice or rate. It is intentionally small:
// this is a latency accelerator for repeated fixed phrases, not a transcript
// archive.
type shortSpeechCache struct {
	mu       sync.Mutex
	items    map[string][]byte
	order    []string
	bytes    int
	maxItems int
	maxBytes int
}

var generatedShortSpeech = shortSpeechCache{
	items:    make(map[string][]byte),
	maxItems: 64,
	maxBytes: 2 * 1024 * 1024,
}

func cacheableSpeechText(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" || len([]rune(text)) > 32 || strings.ContainsAny(text, "\r\n") || strings.Contains(text, "http") {
		return false
	}
	for _, r := range text {
		if r >= '0' && r <= '9' {
			return false
		}
	}
	return true
}

// 中文注释：把合成配置和文本组合成缓存键，避免不同人物或参数复用同一音频。
func speechCacheKey(cfg SpeechSynthesis, text string) string {
	if cfg.WorkspaceID == "" && cfg.CredentialScope == "" {
		return ""
	}
	seed := ""
	if cfg.Seed != nil {
		seed = fmt.Sprintf("%d", *cfg.Seed)
	}
	return fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%s\x00%.4f\x00%.4f\x00%d\x00%s\x00%s\x00%s",
		cfg.WorkspaceID, cfg.CredentialScope, cfg.VoiceID, cfg.Model, cfg.Voice, cfg.Rate, cfg.Pitch, cfg.Volume, cfg.Instruction, seed, text)
}

func (c *shortSpeechCache) get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	audio, ok := c.items[key]
	if !ok {
		return nil, false
	}
	return append([]byte(nil), audio...), true
}

func (c *shortSpeechCache) put(key string, audio []byte) {
	if key == "" || len(audio) == 0 || len(audio) > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if old, ok := c.items[key]; ok {
		c.bytes -= len(old)
	}
	c.items[key] = append([]byte(nil), audio...)
	c.order = append(c.order, key)
	c.bytes += len(audio)
	for len(c.order) > c.maxItems || c.bytes > c.maxBytes {
		oldKey := c.order[0]
		c.order = c.order[1:]
		old, ok := c.items[oldKey]
		if !ok {
			continue
		}
		delete(c.items, oldKey)
		c.bytes -= len(old)
	}
}

// CosySession replaces only generated audio. Recording events retain their
// playback identifiers and bypass synthesis. All output runs through one actor,
// so a cancelled task can never append audio to a newer response.
type CosySession struct {
	VoiceSession
	config SpeechSynthesis
	key    string
	// Each call owns a bounded TLS resumption cache. The config is immutable;
	// every new websocket gets a clone before dialing. No TTS task is reused.
	synthesisTLS              *tls.Config
	log                       *slog.Logger
	events                    chan Event
	packets                   chan synthesisPacket
	wake                      chan struct{}
	fixedSpeech               chan fixedSpeechRequest
	ctx                       context.Context
	cancel                    context.CancelFunc
	mu                        sync.Mutex
	turn                      *synthesisTurn
	localSpeechID             string
	closingSpeechID           string
	epoch                     uint64
	generatedOpeningRequested bool
	workers                   sync.WaitGroup
	closeOnce                 sync.Once
	// Per-session test seam; production always runs the provider connection.
	synthesisWorker   func(*synthesisTurn)
	synthesisEndpoint string // Local protocol fixture only; empty uses the provider endpoint.
}

// 中文注释：在已有模型会话上包装复刻音色合成能力。
func WithSpeechSynthesis(base VoiceSession, cfg SpeechSynthesis, key string, log *slog.Logger) *CosySession {
	return &CosySession{VoiceSession: base, config: cfg, key: key, synthesisTLS: &tls.Config{ClientSessionCache: tls.NewLRUClientSessionCache(4)}, log: log, events: make(chan Event, 128), packets: make(chan synthesisPacket, 128), wake: make(chan struct{}, 1), fixedSpeech: make(chan fixedSpeechRequest)}
}
func (s *CosySession) Start(ctx context.Context, cfg SessionConfig) error {
	if cfg.OutputFormat.RateHz != 24000 {
		return errors.New("CosyVoice requires 24kHz PCM output")
	}
	s.ctx, s.cancel = context.WithCancel(ctx)
	go s.forward()
	if err := s.VoiceSession.Start(ctx, cfg); err != nil {
		s.cancel()
		return err
	}
	// Only a direct realtime session's successful Start proves that an opening
	// response was requested. Recorded wrappers decide SkipOpening internally;
	// do not infer that their first model response is a generated greeting.
	if _, direct := s.VoiceSession.(*Realtime); direct && !cfg.SkipOpening {
		s.mu.Lock()
		s.generatedOpeningRequested = true
		s.mu.Unlock()
	}
	s.log.Info("auditioned speech synthesis active", "synthesisModel", s.config.Model, "rate", s.config.Rate, "pitch", s.config.Pitch,
		"volume", s.config.Volume, "instructionCharacters", len([]rune(s.config.Instruction)), "seedConfigured", s.config.Seed != nil, "voiceId", s.config.VoiceID)
	return nil
}

func (s *CosySession) GeneratedOpeningRequested() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generatedOpeningRequested
}

func (s *CosySession) Events() <-chan Event { return s.events }
func (s *CosySession) emit(e Event) bool {
	select {
	case s.events <- e:
		return true
	case <-s.ctx.Done():
		return false
	}
}
func (s *CosySession) stopSpeech() { s.stopSpeechReason("system_stop") }
func (s *CosySession) stopSpeechReason(reason string) {
	s.mu.Lock()
	if t := s.turn; t != nil {
		t.cancelled = true
		if t.cancelReason == "" {
			t.cancelReason = reason
		}
		t.cancel()
	}
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *CosySession) Interrupt(reason InterruptReason, playedMs int) error {
	s.stopSpeechReason("interrupt_" + strings.ToLower(string(reason)))
	return s.VoiceSession.Interrupt(reason, playedMs)
}

// 中文注释：按回复标识停止对应合成，避免误取消其他轮次。
func (s *CosySession) InterruptResponse(trace ResponseTrace, reason InterruptReason, playedMs int) error {
	s.stopResponseSpeech(trace, "interrupt_"+strings.ToLower(string(reason)))
	if c, ok := s.VoiceSession.(interface {
		InterruptResponse(ResponseTrace, InterruptReason, int) error
	}); ok {
		return c.InterruptResponse(trace, reason, playedMs)
	}
	return s.VoiceSession.Interrupt(reason, playedMs)
}

// 中文注释：停止指定回复的语音生产和待发送内容。
func (s *CosySession) stopResponseSpeech(trace ResponseTrace, reason string) {
	s.mu.Lock()
	if t := s.turn; t != nil && trace.SameResponse(t.trace) {
		t.cancelled = true
		if t.cancelReason == "" {
			t.cancelReason = reason
		}
		t.cancel()
	}
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *CosySession) SpeakText(text string, closing bool) error {
	s.stopSpeechReason("replacement_speech")
	return s.VoiceSession.SpeakText(text, closing)
}

// 中文注释：以固定结束文本进入合成流程，并保留结束语标识。
// SpeakClosing owns a local playback identity before synthesis starts. It uses
// the configured farewell and selected voice, without another LLM response.
func (s *CosySession) SpeakClosing(text, id string) error {
	if strings.TrimSpace(text) == "" || id == "" || s.ctx == nil {
		return errors.New("closing speech is unavailable")
	}
	req := fixedSpeechRequest{text: text, closingID: id, result: make(chan bool, 1)}
	select {
	case s.fixedSpeech <- req:
	case <-s.ctx.Done():
		return errors.New("speech session closed")
	}
	select {
	case started := <-req.result:
		if !started {
			return errors.New("closing speech could not reserve playback")
		}
		return nil
	case <-s.ctx.Done():
		return errors.New("speech session closed")
	}
}

// 中文注释：尝试播放固定文本，返回是否接管以及错误。
// SpeakFixed uses the already selected voice without requesting another model
// response. Its events have a local playback identity and remain interruptible.
func (s *CosySession) SpeakFixed(text string) (bool, error) {
	if strings.TrimSpace(text) == "" || s.ctx == nil {
		return false, errors.New("fixed speech is unavailable")
	}
	req := fixedSpeechRequest{text: text, result: make(chan bool, 1)}
	select {
	case s.fixedSpeech <- req:
	case <-s.ctx.Done():
		return false, errors.New("speech session closed")
	}
	select {
	case started := <-req.result:
		return started, nil
	case <-s.ctx.Done():
		return false, errors.New("speech session closed")
	}
}

// 中文注释：取消指定固定话术的合成或播放。
func (s *CosySession) CancelFixedSpeech(id string) {
	s.mu.Lock()
	if id == "" || s.localSpeechID != id {
		s.mu.Unlock()
		return
	}
	s.localSpeechID = ""
	closing := id == s.closingSpeechID
	if t := s.turn; t != nil && t.localID == id {
		t.cancelled = true
		t.cancelReason = "fixed_speech_cancelled"
		t.cancel()
	}
	s.mu.Unlock()
	if !closing {
		if control, ok := s.VoiceSession.(interface{ ReleaseReply() }); ok {
			control.ReleaseReply()
		}
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Acknowledge the action without generating a second copy of spoken audio.
func (s *CosySession) AcknowledgeTool(callID, output string) error {
	if c, ok := s.VoiceSession.(interface{ AcknowledgeTool(string, string) error }); ok {
		return c.AcknowledgeTool(callID, output)
	}
	return errors.New("silent tool acknowledgement unavailable")
}
func (s *CosySession) Close(ctx context.Context) error {
	s.closeOnce.Do(func() {
		s.stopSpeechReason("session_closed")
		if s.cancel != nil {
			s.cancel()
		}
	})
	return s.VoiceSession.Close(ctx)
}
func (s *CosySession) HoldReply() error {
	s.stopSpeechReason("reply_held")
	if c, ok := s.VoiceSession.(interface{ HoldReply() error }); ok {
		return c.HoldReply()
	}
	return errors.New("reply control unavailable")
}

func (s *CosySession) HoldReplyResponse(trace ResponseTrace) (bool, error) {
	c, ok := s.VoiceSession.(interface {
		HoldReplyResponse(ResponseTrace) (bool, error)
	})
	if !ok {
		return false, errors.New("targeted reply control unavailable")
	}
	held, err := c.HoldReplyResponse(trace)
	if held && err == nil {
		s.stopResponseSpeech(trace, "reply_held")
	}
	return held, err
}

func (s *CosySession) GuideReplyResponse(trace ResponseTrace, hint string) (bool, error) {
	c, ok := s.VoiceSession.(interface {
		GuideReplyResponse(ResponseTrace, string) (bool, error)
	})
	if !ok {
		return false, errors.New("targeted reply guidance unavailable")
	}
	requested, err := c.GuideReplyResponse(trace, hint)
	if requested && err == nil {
		s.stopResponseSpeech(trace, "reply_guidance")
	}
	return requested, err
}
func (s *CosySession) GuideReply(text string) error {
	s.stopSpeechReason("reply_guidance")
	if c, ok := s.VoiceSession.(interface{ GuideReply(string) error }); ok {
		return c.GuideReply(text)
	}
	return errors.New("reply control unavailable")
}
func (s *CosySession) ReleaseReply() {
	if c, ok := s.VoiceSession.(interface{ ReleaseReply() }); ok {
		c.ReleaseReply()
	}
}

func (s *CosySession) ResolveDirectReply(text string, trace ResponseTrace) bool {
	if c, ok := s.VoiceSession.(interface {
		ResolveDirectReply(string, ResponseTrace) bool
	}); ok {
		return c.ResolveDirectReply(text, trace)
	}
	return false
}
func (s *CosySession) EnsureReplyIfIdle(hint string) (bool, error) {
	s.mu.Lock()
	busy := s.turn != nil && !s.turn.cancelled && !s.turn.finished
	s.mu.Unlock()
	if busy {
		return false, nil
	}
	if c, ok := s.VoiceSession.(interface{ EnsureReplyIfIdle(string) (bool, error) }); ok {
		return c.EnsureReplyIfIdle(hint)
	}
	return false, errors.New("idle reply control unavailable")
}
func (s *CosySession) InterruptRecording(id string, why InterruptReason, ms int) error {
	s.mu.Lock()
	local := id != "" && id == s.localSpeechID
	s.mu.Unlock()
	if local {
		s.CancelFixedSpeech(id)
		return nil
	}
	s.stopSpeechReason("recording_interrupt_" + strings.ToLower(string(why)))
	if c, ok := s.VoiceSession.(interface {
		InterruptRecording(string, InterruptReason, int) error
	}); ok {
		return c.InterruptRecording(id, why, ms)
	}
	return nil
}
func (s *CosySession) ActiveRecording() string {
	s.mu.Lock()
	local := s.localSpeechID != ""
	s.mu.Unlock()
	if local {
		return FixedFollowUpRecordingKey
	}
	if c, ok := s.VoiceSession.(interface{ ActiveRecording() string }); ok {
		return c.ActiveRecording()
	}
	return ""
}
func (s *CosySession) PausedRecording() string {
	if c, ok := s.VoiceSession.(interface{ PausedRecording() string }); ok {
		return c.PausedRecording()
	}
	return ""
}
func (s *CosySession) ResumeRecording() (string, error) {
	s.stopSpeechReason("recording_resumed")
	if c, ok := s.VoiceSession.(interface{ ResumeRecording() (string, error) }); ok {
		return c.ResumeRecording()
	}
	return "", nil
}
func (s *CosySession) DiscardRecording() {
	if c, ok := s.VoiceSession.(interface{ DiscardRecording() }); ok {
		c.DiscardRecording()
	}
}
func (s *CosySession) RecordingPlayed(id string) {
	s.mu.Lock()
	local := id != "" && id == s.localSpeechID
	s.mu.Unlock()
	if local {
		s.CancelFixedSpeech(id)
		return
	}
	if c, ok := s.VoiceSession.(interface{ RecordingPlayed(string) }); ok {
		c.RecordingPlayed(id)
	}
}

func (s *CosySession) turnLog(t *synthesisTurn) *slog.Logger {
	return s.log.With(t.trace.LogAttrs()...)
}

func (s *CosySession) forward() {
	defer func() { s.stopSpeechReason("base_session_closed"); s.cancel(); s.workers.Wait(); close(s.events) }()
	for {
		select {
		case <-s.ctx.Done():
			return
		case req := <-s.fixedSpeech:
			if req.closingID != "" {
				floor, ok := s.VoiceSession.(interface{ HoldReply() error })
				if !ok || floor.HoldReply() != nil {
					req.result <- false
					continue
				}
				s.DiscardRecording()
				s.mu.Lock()
				s.closingSpeechID = req.closingID
				if s.turn != nil {
					s.turn.cancelled = true
					s.turn.cancelReason = "fixed_closing"
					s.turn.cancel()
				}
				s.mu.Unlock()
			} else {
				s.mu.Lock()
				busy := s.turn != nil || s.localSpeechID != "" || s.closingSpeechID != ""
				s.mu.Unlock()
				floor, ok := s.VoiceSession.(interface{ HoldReplyIfIdle() bool })
				if busy || !ok || !floor.HoldReplyIfIdle() {
					req.result <- false
					continue
				}
			}
			s.mu.Lock()
			s.epoch++
			ctx, cancel := context.WithCancel(s.ctx)
			now := time.Now()
			id := "fixed-speech-" + uuid.NewString()
			if req.closingID != "" {
				id = req.closingID
			}
			end := Event{Type: EventTypeResponseDone, Status: "completed", PlaybackID: id, RecordingKey: FixedFollowUpRecordingKey}
			t := &synthesisTurn{epoch: s.epoch, localID: id, ctx: ctx, cancel: cancel, input: make(chan string, 128), responseStartedAt: now, firstTextAt: now, buffer: req.text, transcript: req.text, baseDone: &end}
			s.turn, s.localSpeechID = t, id
			if s.synthesisWorker == nil {
				s.prepareSynthesisConnection(t)
			}
			s.flushText(t, true)
			close(t.input)
			s.mu.Unlock()
			if req.closingID != "" {
				s.log.Info("configured closing uses selected synthesizer", "playbackId", id, "synthesisModel", s.config.Model)
			}
			s.emit(Event{Type: EventTypeResponseStarted, PlaybackID: id, RecordingKey: FixedFollowUpRecordingKey})
			s.emit(Event{Type: EventTypeOutputTranscript, PlaybackID: id, RecordingKey: FixedFollowUpRecordingKey, Text: req.text, IsFinal: true})
			req.result <- true
		case <-s.wake:
			s.mu.Lock()
			t := s.turn
			var end *Event
			if t != nil && t.cancelled && t.baseDone != nil {
				end = t.baseDone
				s.turn = nil
			}
			s.mu.Unlock()
			if end != nil {
				s.emit(Event{Type: EventTypeInterrupted, Trace: end.Trace, Status: "cancelled", Usage: end.Usage, InterruptedBy: InterruptReasonSystem, PlaybackID: end.PlaybackID, RecordingKey: end.RecordingKey})
			}
		case p := <-s.packets:
			s.mu.Lock()
			t := s.turn
			if t == nil || t.epoch != p.epoch || t.cancelled {
				s.mu.Unlock()
				continue
			}
			if p.err != nil {
				t.cancelReason = "synthesis_error"
				t.cancelled = true
				t.cancel()
				localID := t.localID
				if localID != "" {
					s.turn = nil
				}
				s.mu.Unlock()
				s.turnLog(t).Error("speech synthesis failed", "synthesisModel", s.config.Model, "epoch", t.epoch, "error", p.err)
				if localID != "" {
					s.emit(Event{Type: EventTypeInterrupted, Status: "fixed_synthesis_failed", PlaybackID: localID, RecordingKey: FixedFollowUpRecordingKey, InterruptedBy: InterruptReasonSystem})
					continue
				}
				s.emit(Event{Type: EventTypeError, IsFatal: true, Text: "speech synthesis unavailable", Err: p.err})
				continue
			}
			if len(p.audio) > 0 && t.cacheCapture {
				t.cacheAudio = append(t.cacheAudio, p.audio...)
			}
			if p.done {
				t.finished = true
				if t.cacheCapture && t.cacheKey != "" && len(t.cacheAudio) > 0 {
					generatedShortSpeech.put(t.cacheKey, t.cacheAudio)
					t.cacheCapture = false
				}
			}
			end := t.baseDone
			if !t.finished {
				end = nil
			} else if end != nil {
				s.turn = nil
				t.cancel()
			}
			s.mu.Unlock()
			if len(p.audio) > 0 {
				e := Event{Type: EventTypeAudioDelta, Audio: p.audio, Trace: t.trace}
				if t.localID != "" {
					e.PlaybackID, e.RecordingKey = t.localID, FixedFollowUpRecordingKey
				}
				s.emit(e)
			}
			if p.done {
				s.turnLog(t).Info("speech synthesis completed", "synthesisModel", s.config.Model, "epoch", t.epoch, "characters", p.characters)
			}
			if end != nil {
				s.emit(*end)
			}
		case e, ok := <-s.VoiceSession.Events():
			if !ok {
				return
			}
			// Provider responses, including late cancellation and recording
			// receipts, do not own the committed local closing playback.
			s.mu.Lock()
			closing := s.closingSpeechID != ""
			s.mu.Unlock()
			if closing && (e.Type == EventTypeResponseStarted || e.Type == EventTypeAudioDelta || e.Type == EventTypeOutputTranscript || e.Type == EventTypeResponseDone || e.Type == EventTypeInterrupted || e.Type == EventTypeToolCall) {
				continue
			}
			// Original recordings must never be converted to generated speech.
			if e.PlaybackID != "" {
				s.emit(e)
				continue
			}
			s.mu.Lock()
			t := s.turn
			if t != nil && (e.Type == EventTypeOutputTranscript || e.Type == EventTypeResponseDone || e.Type == EventTypeInterrupted || e.Type == EventTypeToolCall) && !e.Trace.SameResponse(t.trace) {
				s.mu.Unlock()
				s.log.Info("ignored stale synthesis response event", append(e.Trace.LogAttrs(), "type", e.Type)...)
				continue
			}
			switch e.Type {
			case EventTypeResponseStarted:
				var prior *Event
				localID := s.localSpeechID
				if t != nil {
					if t.cancelReason == "" {
						t.cancelReason = "superseded_response"
					}
					t.cancelled = true
					t.cancel()
					if t.baseDone != nil {
						prior = t.baseDone
					}
				}
				s.epoch++
				ctx, cancel := context.WithCancel(s.ctx)
				s.turn = &synthesisTurn{epoch: s.epoch, trace: e.Trace, ctx: ctx, cancel: cancel, input: make(chan string, 128), responseStartedAt: time.Now()}
				if s.synthesisWorker == nil {
					s.prepareSynthesisConnection(s.turn)
				}
				s.mu.Unlock()
				if localID != "" {
					s.CancelFixedSpeech(localID)
				}
				if prior != nil {
					s.emit(Event{Type: EventTypeInterrupted, Trace: prior.Trace, Status: "cancelled", Usage: prior.Usage, InterruptedBy: InterruptReasonSystem, PlaybackID: prior.PlaybackID, RecordingKey: prior.RecordingKey})
				} else if localID != "" {
					s.emit(Event{Type: EventTypeInterrupted, Status: "cancelled", InterruptedBy: InterruptReasonSystem, PlaybackID: localID, RecordingKey: FixedFollowUpRecordingKey})
				}
				s.emit(e)
			case EventTypeAudioDelta:
				// The realtime voice is deliberately inaudible for this binding.
				s.mu.Unlock()
			case EventTypeOutputTranscript:
				if t != nil && !t.cancelled {
					if t.firstTextAt.IsZero() && strings.TrimSpace(e.Text) != "" {
						t.firstTextAt = time.Now()
						s.turnLog(t).Info("speech synthesis first text received", "synthesisModel", s.config.Model, "epoch", t.epoch,
							"responseToFirstTextMs", t.firstTextAt.Sub(t.responseStartedAt).Milliseconds())
					}
					if e.IsFinal {
						if strings.HasPrefix(e.Text, t.transcript) {
							t.buffer += strings.TrimPrefix(e.Text, t.transcript)
							t.transcript = e.Text
						}
					} else {
						t.transcript += e.Text
						t.buffer += e.Text
					}
					// Transport is already prepared from response.started. Decide
					// whether the first complete phrase is cached before starting
					// its task, so a cache hit cannot strand an empty live task.
					s.flushText(t, e.IsFinal)
				}
				blocked := t != nil && t.cancelled
				s.mu.Unlock()
				if !blocked {
					s.emit(e)
				}
			case EventTypeResponseDone:
				if t == nil {
					s.mu.Unlock()
					s.emit(e)
					continue
				}
				if t.cancelled {
					t.cancel()
					s.turn = nil
					s.mu.Unlock()
					s.emit(Event{Type: EventTypeInterrupted, Trace: e.Trace, Status: "cancelled", Usage: e.Usage, InterruptedBy: InterruptReasonSystem})
					continue
				}
				s.flushText(t, true)
				if !t.started {
					s.turn = nil
					t.cancel()
					s.mu.Unlock()
					s.emit(e)
					continue
				}
				t.baseDone = &e
				close(t.input)
				finished := t.finished
				if finished {
					s.turn = nil
					t.cancel()
				}
				s.mu.Unlock()
				if finished {
					s.emit(e)
				}
			case EventTypeInterrupted:
				if t != nil {
					if t.cancelReason == "" {
						t.cancelReason = "base_interrupt_" + strings.ToLower(string(e.InterruptedBy))
					}
					t.cancelled = true
					t.cancel()
				}
				s.turn = nil
				s.mu.Unlock()
				s.emit(e)
			default:
				s.mu.Unlock()
				s.emit(e)
			}
		}
	}
}

// Prepare transport while the model thinks. No run-task or text is sent here.
// Ownership transfers once to synthesize; unused connections close on cancellation
// or after ten seconds, including tool-only and interrupted responses.
func (s *CosySession) prepareSynthesisConnection(t *synthesisTurn) {
	ready := make(chan synthesisConnection)
	t.connection = ready
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		defer close(ready)
		ctx, cancel := context.WithTimeout(t.ctx, 10*time.Second)
		defer cancel()
		c := s.dialSynthesis(ctx)
		select {
		case ready <- c:
		case <-ctx.Done():
			if c.conn != nil {
				_ = c.conn.Close()
			}
		}
	}()
}
// 中文注释：建立语音合成连接并保存连接结果。
func (s *CosySession) dialSynthesis(ctx context.Context) synthesisConnection {
	dialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	if s.synthesisTLS != nil {
		dialer.TLSClientConfig = s.synthesisTLS.Clone()
	}
	endpoint := s.synthesisEndpoint
	if endpoint == "" {
		endpoint = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
	}
	c := synthesisConnection{startedAt: time.Now()}
	var res *http.Response
	c.conn, res, c.err = dialer.DialContext(ctx, endpoint, http.Header{"Authorization": []string{"Bearer " + s.key}})
	c.readyAt = time.Now()
	if res != nil {
		c.requestID = providerUpgradeRequestID(res.Header)
		if c.err != nil && res.Body != nil {
			res.Body.Close()
		}
	}
	return c
}

// 中文注释：启动当前轮次的合成处理。
// Caller holds mu. One worker, and therefore one connection, per response.
func (s *CosySession) beginSynthesis(t *synthesisTurn) {
	if t.started || t.cancelled {
		return
	}
	t.started = true
	t.synthesisStartedAt = time.Now()
	worker := s.synthesisWorker
	if worker == nil {
		worker = s.synthesize
	}
	// Snapshot a cache hit under the actor's mutex. cacheAudio is also the
	// capture buffer for live synthesis and must never be read by a worker
	// while the actor appends received audio to it.
	cachedAudio := append([]byte(nil), t.cacheAudio...)
	s.workers.Add(1)
	go func() {
		defer s.workers.Done()
		if len(cachedAudio) > 0 {
			s.packet(t, synthesisPacket{audio: cachedAudio})
			s.packet(t, synthesisPacket{done: true})
			return
		}
		worker(t)
	}()
}

const (
	firstHanPhraseMin      = 4
	subsequentHanPhraseMin = 8
	mixedPhraseMaxRunes    = 12
)

// 中文注释：根据当前文本、标点与分片阈值提交可合成片段；最终片段在结束时补交。
// Caller holds mu. Send complete phrase fragments, preserving every character.
func (s *CosySession) flushText(t *synthesisTurn, final bool) {
	if t.buffer == "" {
		return
	}
	cut := 0
	if final {
		cut = len(t.buffer)
	} else {
		n, han := 0, 0
		for i, r := range t.buffer {
			n++
			if unicode.In(r, unicode.Han) {
				han++
			}
			minimum := 6
			// Let a short first acknowledgement such as "好的，" reach TTS
			// at its own punctuation. Later phrases keep the existing threshold.
			if t.firstPhraseAt.IsZero() && han >= 2 {
				minimum = 3
			}
			if n >= minimum && strings.ContainsRune("，。！？；,.!?;", r) {
				cut = i + len(string(r))
				break
			}
		}
		if cut == 0 {
			minHan := subsequentHanPhraseMin
			if t.firstPhraseAt.IsZero() {
				minHan = firstHanPhraseMin
			}
			cut = hanPhraseCut(t.buffer, minHan, mixedPhraseMaxRunes)
		}
		if cut == 0 {
			cut = englishPhraseCut(t.buffer)
		}
	}
	if cut == 0 {
		return
	}
	if t.firstPhraseAt.IsZero() {
		t.firstPhraseAt = time.Now()
		s.turnLog(t).Info("speech synthesis first phrase ready", "synthesisModel", s.config.Model, "epoch", t.epoch,
			"firstTextToPhraseMs", t.firstPhraseAt.Sub(t.firstTextAt).Milliseconds(), "characters", len([]rune(t.buffer[:cut])))
	}
	text := t.buffer[:cut]
	t.buffer = t.buffer[cut:]
	// started covers text already queued, including a first phrase whose
	// provider task has not acknowledged it yet. A later suffix must never
	// replace that queued phrase or be cached as a complete response.
	if final && !t.started && cacheableSpeechText(text) {
		key := speechCacheKey(s.config, text)
		if audio, ok := generatedShortSpeech.get(key); ok {
			t.cacheKey = key
			t.cacheAudio = audio
			t.cacheCapture = false
			s.turnLog(t).Info("speech synthesis short phrase cache hit", "synthesisModel", s.config.Model, "characters", len([]rune(text)), "audioBytes", len(audio))
			s.beginSynthesis(t)
			return
		}
		t.cacheKey = key
		t.cacheCapture = true
	}
	s.beginSynthesis(t)
	select {
	case t.input <- text:
	case <-t.ctx.Done():
	default:
		t.cancelReason = "text_queue_limit"
		t.cancelled = true
		t.cancel()
		go s.packet(t, synthesisPacket{err: errors.New("speech text queue exceeded")})
	}
}

// 中文注释：计算中文片段的可切分位置，兼顾字符阈值和短语边界。
// hanPhraseCut starts Chinese or mixed-language synthesis without waiting for
// punctuation. It always returns a UTF-8 byte boundary. The maxRunes fallback
// prevents a mixed-language response from waiting indefinitely when it contains
// too few Han characters to reach minHan.
func hanPhraseCut(text string, minHan, maxRunes int) int {
	han, runes := 0, 0
	for i, r := range text {
		runes++
		if unicode.In(r, unicode.Han) {
			han++
		}
		if han >= minHan || (runes >= maxRunes && han > 0) {
			return i + len(string(r))
		}
	}
	return 0
}

// 中文注释：为英文流式文本寻找可合成的短语切分位置。
// A long English sentence need not wait for punctuation before TTS starts.
// Cut only at an existing space, include that space, and leave every other
// byte in the buffer.
func englishPhraseCut(text string) int {
	count, latin, cut := 0, 0, 0
	for i, r := range text {
		if unicode.In(r, unicode.Han) {
			return 0
		}
		count++
		if unicode.In(r, unicode.Latin) {
			latin++
		}
		if count >= 28 && count <= 48 && unicode.IsSpace(r) {
			cut = i + len(string(r))
		}
	}
	if count < 48 || latin < 20 {
		return 0
	}
	return cut
}

func (s *CosySession) packet(t *synthesisTurn, p synthesisPacket) {
	p.epoch = t.epoch
	select {
	case s.packets <- p:
	case <-t.ctx.Done():
	case <-s.ctx.Done():
	}
}

// providerUpgradeRequestID returns only a provider-issued upgrade identifier.
// A locally generated task UUID is logged separately as clientTaskId.
func providerUpgradeRequestID(header http.Header) string {
	for _, name := range []string{"X-Request-Id", "X-Dashscope-Request-Id", "Request-Id"} {
		if value := header.Get(name); value != "" {
			return value
		}
	}
	return ""
}

// 中文注释：处理合成连接、文本提交及音频返回，将结果交给当前语音事件流。
func (s *CosySession) synthesize(t *synthesisTurn) {
	ctx, cancel := context.WithTimeout(t.ctx, 45*time.Second)
	defer cancel()
	const shutdownBudget = 800 * time.Millisecond
	const sendBudget = 250 * time.Millisecond
	task := strings.ReplaceAll(uuid.NewString(), "-", "")
	requestID := ""
	outcome, finishMode := "failed", "not_sent"
	var finishMu sync.Mutex
	setFinishMode := func(value string) { finishMu.Lock(); finishMode = value; finishMu.Unlock() }
	getFinishMode := func() string { finishMu.Lock(); defer finishMu.Unlock(); return finishMode }
	bytes := 0
	startedAt := time.Now()
	defer func() {
		s.mu.Lock()
		reason := t.cancelReason
		s.mu.Unlock()
		if outcome != "completed" && t.ctx.Err() != nil {
			outcome = "cancelled"
			if reason == "" {
				reason = "parent_context_closed"
			}
		} else if outcome != "completed" && ctx.Err() != nil {
			outcome = "timeout"
			reason = "synthesis_deadline"
		}
		s.turnLog(t).Info("speech synthesis task closed", "synthesisModel", s.config.Model, "epoch", t.epoch,
			"clientTaskId", task, "providerRequestId", requestID, "outcome", outcome,
			"cancelReason", reason, "finishMode", getFinishMode(), "audioBytes", bytes,
			"durationMs", time.Since(startedAt).Milliseconds())
	}()
	var prepared synthesisConnection
	var available bool
	if t.connection != nil {
		select {
		case prepared, available = <-t.connection:
		case <-ctx.Done():
			return
		}
	}
	if !available {
		prepared = s.dialSynthesis(ctx)
	}
	conn, err := prepared.conn, prepared.err
	connectedAt := prepared.readyAt
	requestID = prepared.requestID
	if err != nil {
		if t.ctx.Err() == nil {
			s.packet(t, synthesisPacket{err: errors.New("CosyVoice connection failed")})
		}
		return
	}
	s.turnLog(t).Info("speech synthesis connection ready", "synthesisModel", s.config.Model, "epoch", t.epoch,
		"clientTaskId", task, "providerRequestId", requestID,
		"connectMs", prepared.readyAt.Sub(prepared.startedAt).Milliseconds(),
		"responseToConnectMs", prepared.readyAt.Sub(t.responseStartedAt).Milliseconds(),
		"connectionPreparedEarly", available)
	workerDone := make(chan struct{})
	defer func() {
		close(workerDone)
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(100*time.Millisecond))
		_ = conn.Close()
	}()
	conn.SetReadLimit(8 * 1024 * 1024)
	// Playback stops at t.cancel immediately. Only this detached worker drains
	// the provider terminal event; phone interruption never waits for the cloud.
	go func() {
		select {
		case <-workerDone:
			return
		case <-ctx.Done():
		}
		timer := time.NewTimer(shutdownBudget)
		defer timer.Stop()
		select {
		case <-workerDone:
		case <-timer.C:
			_ = conn.Close()
		}
	}()
	send := func(action string, payload any) error {
		writeBudget := 5 * time.Second
		if ctx.Err() != nil {
			writeBudget = sendBudget
		}
		conn.SetWriteDeadline(time.Now().Add(writeBudget))
		return conn.WriteJSON(map[string]any{"header": map[string]any{"action": action, "task_id": task, "streaming": "duplex"}, "payload": payload})
	}
	if ctx.Err() != nil {
		return
	}
	params := map[string]any{"voice": s.config.Voice, "format": "pcm", "sample_rate": 24000, "volume": s.config.Volume, "rate": s.config.Rate, "pitch": s.config.Pitch}
	if s.config.Instruction != "" {
		params["instruction"] = s.config.Instruction
	}
	if s.config.Seed != nil {
		params["seed"] = *s.config.Seed
	}
	runTaskAt := time.Now()
	err = send("run-task", map[string]any{"task_group": "audio", "task": "tts", "function": "SpeechSynthesizer", "model": s.config.Model, "parameters": params, "input": map[string]any{}})
	if err != nil {
		if t.ctx.Err() == nil {
			s.packet(t, synthesisPacket{err: errors.New("CosyVoice task submission failed")})
		}
		return
	}
	started := false
	var taskStartedAt time.Time
	writerDone := make(chan error, 1)
	startWriter := func() {
		// The reader can receive a more specific request ID later. Capture its
		// current value for this writer so logging introduces no shared writes.
		writerRequestID := requestID
		go func() {
			finish := func(cancelled bool) error {
				input := map[string]any{}
				mode := "normal"
				if cancelled {
					input["directive"] = "cancel"
					mode = "cancel"
				}
				setFinishMode(mode + "_requested")
				err := send("finish-task", map[string]any{"input": input})
				if err == nil {
					setFinishMode(mode + "_sent")
				} else {
					_ = conn.Close()
				}
				return err
			}
			for {
				// Check before dequeuing so queued old text cannot win against
				// the cancellation signal and enter the next spoken response.
				if ctx.Err() != nil {
					writerDone <- finish(true)
					return
				}
				select {
				case <-workerDone:
					return
				case <-ctx.Done():
					writerDone <- finish(true)
					return
				case text, ok := <-t.input:
					if ctx.Err() != nil {
						writerDone <- finish(true)
						return
					}
					if !ok {
						// Never issue a second finish-task if a later interruption
						// arrives while this normally-finished task drains audio.
						writerDone <- finish(false)
						return
					}
					s.mu.Lock()
					firstSubmission := t.firstSubmittedAt.IsZero()
					if firstSubmission {
						t.firstSubmittedAt = time.Now()
					}
					firstSubmittedAt, firstTextAt, firstPhraseAt := t.firstSubmittedAt, t.firstTextAt, t.firstPhraseAt
					s.mu.Unlock()
					if err := send("continue-task", map[string]any{"input": map[string]any{"text": text}}); err != nil {
						writerDone <- err
						_ = conn.Close()
						return
					}
					if firstSubmission {
						s.turnLog(t).Info("speech synthesis first text submitted", "synthesisModel", s.config.Model, "epoch", t.epoch,
							"clientTaskId", task, "providerRequestId", writerRequestID,
							"taskStartedWaitMs", taskStartedAt.Sub(runTaskAt).Milliseconds(),
							"firstTextToSubmitMs", firstSubmittedAt.Sub(firstTextAt).Milliseconds(),
							"firstPhraseToSubmitMs", firstSubmittedAt.Sub(firstPhraseAt).Milliseconds())
					}
				}
			}
		}()
	}
	for {
		conn.SetReadDeadline(time.Now().Add(15 * time.Second))
		kind, data, readErr := conn.ReadMessage()
		if readErr != nil {
			if ctx.Err() != nil {
				s.turnLog(t).Info("speech synthesis cancellation drain ended", "synthesisModel", s.config.Model, "epoch", t.epoch,
					"clientTaskId", task, "providerRequestId", requestID, "finishMode", getFinishMode(), "terminalReceived", false)
			}
			if t.ctx.Err() == nil {
				s.packet(t, synthesisPacket{err: errors.New("CosyVoice audio stream ended early")})
			}
			return
		}
		if kind == websocket.BinaryMessage {
			if ctx.Err() != nil {
				continue // Drain cancelled audio without delivering it to playback.
			}
			if len(data)%2 != 0 {
				s.packet(t, synthesisPacket{err: errors.New("invalid CosyVoice PCM frame")})
				return
			}
			if bytes == 0 && len(data) > 0 {
				now := time.Now()
				s.mu.Lock()
				firstPhraseAt, firstTextAt, firstSubmittedAt := t.firstPhraseAt, t.firstTextAt, t.firstSubmittedAt
				s.mu.Unlock()
				s.turnLog(t).Info("speech synthesis first audio received", "synthesisModel", s.config.Model, "epoch", t.epoch,
					"clientTaskId", task, "providerRequestId", requestID,
					"responseToFirstAudioMs", now.Sub(t.responseStartedAt).Milliseconds(),
					"firstTextToFirstAudioMs", now.Sub(firstTextAt).Milliseconds(),
					"phraseToFirstAudioMs", now.Sub(firstPhraseAt).Milliseconds(),
					"submitToFirstAudioMs", now.Sub(firstSubmittedAt).Milliseconds(),
					"connectToFirstAudioMs", now.Sub(connectedAt).Milliseconds())
			}
			bytes += len(data)
			if bytes > 8*1024*1024 {
				s.packet(t, synthesisPacket{err: errors.New("CosyVoice response exceeds limit")})
				return
			}
			s.packet(t, synthesisPacket{audio: data})
			continue
		}
		var e struct {
			Header struct {
				Event      string `json:"event"`
				ErrorCode  string `json:"error_code"`
				RequestID  string `json:"request_id"`
				Attributes struct {
					RequestUUID string `json:"request_uuid"`
				} `json:"attributes"`
			} `json:"header"`
			Payload struct {
				Usage struct {
					Characters int `json:"characters"`
				} `json:"usage"`
			} `json:"payload"`
		}
		if json.Unmarshal(data, &e) != nil {
			continue
		}
		if e.Header.Attributes.RequestUUID != "" {
			requestID = e.Header.Attributes.RequestUUID
		} else if e.Header.RequestID != "" {
			requestID = e.Header.RequestID
		}
		switch e.Header.Event {
		case "task-started":
			if started {
				continue
			}
			started = true
			taskStartedAt = time.Now()
			// Protocol requires task-started before either text or cancellation.
			startWriter()
		case "task-failed":
			s.turnLog(t).Warn("speech synthesis provider task failed", "synthesisModel", s.config.Model, "epoch", t.epoch,
				"clientTaskId", task, "providerRequestId", requestID, "providerErrorCode", e.Header.ErrorCode, "cancelled", t.ctx.Err() != nil)
			if t.ctx.Err() == nil {
				s.packet(t, synthesisPacket{err: fmt.Errorf("CosyVoice task failed: %s", e.Header.ErrorCode)})
			}
			return
		case "task-finished":
			if !started {
				if t.ctx.Err() == nil {
					s.packet(t, synthesisPacket{err: errors.New("CosyVoice task finished before start")})
				}
				return
			}
			if ctx.Err() != nil {
				outcome = "cancelled"
				s.turnLog(t).Info("speech synthesis cancellation drained", "synthesisModel", s.config.Model, "epoch", t.epoch,
					"clientTaskId", task, "providerRequestId", requestID, "finishMode", getFinishMode(), "terminalReceived", true)
				if t.ctx.Err() == nil {
					s.packet(t, synthesisPacket{err: errors.New("CosyVoice synthesis deadline exceeded")})
				}
				return
			}
			var writeErr error
			select {
			case writeErr = <-writerDone:
			case <-ctx.Done():
				if t.ctx.Err() == nil {
					s.packet(t, synthesisPacket{err: errors.New("CosyVoice synthesis deadline exceeded")})
				}
				return
			}
			if writeErr != nil || bytes == 0 {
				s.packet(t, synthesisPacket{err: errors.New("CosyVoice task returned incomplete audio")})
				return
			}
			outcome = "completed"
			s.turnLog(t).Info("speech synthesis provider task finished", "synthesisModel", s.config.Model, "epoch", t.epoch,
				"clientTaskId", task, "providerRequestId", requestID, "characters", e.Payload.Usage.Characters)
			s.packet(t, synthesisPacket{done: true, characters: e.Payload.Usage.Characters})
			return
		}
	}
}
