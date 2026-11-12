// SPDX-License-Identifier: Apache-2.0
// Taigua adaptation: extracted for the existing workspace-scoped sales system.

// Package aicall joins one telephone leg to one speech model: audio in both
// directions, barge-in, keypresses, and the lifecycle that ends both sides
// together. It makes no conversational decisions — those belong to the flow
// engine, which consumes the events this package publishes.
// 中文导读：每通电话独立的媒体与模型会话：管理轮次、音频播放、打断和资源退出。
// 线路媒体、模型事件和播放进度并行运行，通过互斥锁、轮次和代次标识协调。
// 文本生成结束不等于电话端播放结束；收尾与挂断必须结合音频队列及播放完成状态。
// 客户插话会影响当前播放和模型上下文，处理时保留实际已播放的进度。
package aicall

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"taigua/sip-bridge/internal/media"
	"taigua/sip-bridge/internal/obs"
	"taigua/sip-bridge/internal/provider"
)

// frameDurationMs is how much audio one frame carries. It is the unit played
// time is counted in.
const frameDurationMs = 20

// EventType is what the bridge reports upwards.
type EventType string

const (
	// EventTypeReady means the model is configured and the greeting is coming.
	EventTypeReady EventType = "READY"
	// EventTypeCustomerSaid and EventTypeBotSaid are transcript events.
	EventTypeCustomerSaid EventType = "CUSTOMER_SAID"
	EventTypeBotSaid      EventType = "BOT_SAID"
	// EventTypeToolCall is the model asking for something to be done.
	EventTypeToolCall EventType = "TOOL_CALL"
	// EventTypeTurnDone closes a turn, whether it completed or was cut short.
	// It means the model has finished producing, not that the caller has
	// finished hearing.
	EventTypeTurnDone EventType = "TURN_DONE"
	// EventTypePlaybackDone means the last of that audio has left for the
	// caller. Anything that must not happen mid-sentence — a transfer, a
	// hangup — waits for this rather than for TURN_DONE.
	EventTypePlaybackDone EventType = "PLAYBACK_DONE"
	// EventTypeNoInput is dead air: the caller has said nothing since the bot
	// stopped speaking.
	EventTypeNoInput EventType = "NO_INPUT"
	// EventTypeBargeIn is the caller taking the floor back.
	EventTypeBargeIn       EventType = "BARGE_IN"
	EventTypeSpeechStarted EventType = "SPEECH_STARTED"
	EventTypeSpeechStopped EventType = "SPEECH_STOPPED"
	// EventTypeDigit is a keypress.
	EventTypeDigit EventType = "DIGIT"
	// EventTypeFailed means the conversation cannot continue and the call must
	// go somewhere a person can take it.
	EventTypeFailed EventType = "FAILED"
	// EventTypeEnded is the last event on the stream.
	EventTypeEnded EventType = "ENDED"
)

// Event is one thing that happened on an AI call.
type Event struct {
	Trace         provider.ResponseTrace
	Type          EventType
	RecordingKey  string
	DuringOpening bool

	// Turn numbers the model turn an event belongs to (TURN_DONE,
	// PLAYBACK_DONE, TOOL_CALL and BOT_SAID). A consumer sequencing an action "after the line that is
	// about to be spoken" compares turn numbers: the turn a tool call arrived
	// in is not the turn its closing line plays in.
	Turn int

	// Text is transcript text, a digit, or a failure message.
	Text    string
	IsFinal bool

	ToolCallID string
	ToolName   string
	ToolArgs   string

	Status string
	Usage  provider.Usage
	// Unplayed is, on a BARGE_IN, how much of the bot's audio was still queued
	// for the caller when they took the floor. Read before the flush empties
	// the queue; the armed ending needs it to tell an acknowledgement of the
	// closing line ("bye now") from a caller cutting in on it.
	Unplayed time.Duration
	// HasAudio is, on a PLAYBACK_DONE, whether the turn queued any audio for
	// the caller. A turn that only made a tool call plays nothing, and its
	// playback "finishes" at once.
	HasAudio bool

	// IsInterrupted marks a TURN_DONE whose turn was cut short — by the
	// caller, by a keypress, or to make room for another turn. Such a turn
	// never reaches PLAYBACK_DONE, and what it produced is not a line anybody
	// can count on having been said.
	IsInterrupted bool

	Err error
	// FailureCause is why a FAILED event happened, when the provider put a name
	// to it. It becomes the call's hangup cause; empty means the failure has no
	// word of its own, which is most of them.
	FailureCause provider.FailureCause
}

// Config parameterises one bridged call.
type Config struct {
	// Session is the model configuration. Its audio formats are filled in from
	// the negotiated law and the provider profile.
	Session provider.SessionConfig

	// BargeGuard is how long after the bot starts speaking that speech
	// detection is ignored.
	//
	// This exists because of what happens on a real line rather than in a lab:
	// the bot's own voice returns through the caller's handset or speakerphone,
	// the provider's detector hears speech, and the bot interrupts itself
	// mid-greeting. Zero uses the default; negative disables the guard.
	BargeGuard time.Duration

	// NoInput is how long of a silent caller, after the bot has finished
	// speaking, counts as dead air. Zero uses the default; negative disables
	// the check.
	NoInput time.Duration

	// LevelCallerAudio applies bounded gain to quiet PCM speech before ASR.
	Audio        media.AudioSettings
	ManualDigits bool
	// Optional nonblocking observer of inbound PCM, before level/noise processing.
	ObserveInbound func([]byte, media.AudioFormat)

	// IsGreetingGated holds the request for the opening turn until the
	// caller's media path is up. False is the original behaviour: the greeting
	// is asked for the moment the model session is ready. GreetingMediaWait is
	// the grace once gated: zero waits for the first inbound RTP however long
	// (the UAS's first-media timeout still ends a call whose media never
	// starts), positive opens the gate at the first inbound RTP or after this
	// long, whichever is first.
	IsGreetingGated   bool
	GreetingMediaWait time.Duration

	// IsEndingArmed reports whether the call's ending (a transfer or a hangup)
	// is armed and waiting for its closing line to be heard. The orchestrator
	// owns that truth (callActions); the session only asks, and never while
	// holding mu, because arming reads the session's current turn under the
	// actions' own lock. Nil is never armed.
	IsEndingArmed func() bool

	// Logger is the call's logger. The orchestrator has already bound the
	// call's identity to it (callId, aiccCallId, did), so the session adds
	// no key of its own: slog writes a key bound twice twice.
	Logger *slog.Logger
}

// Defaults chosen from field experience rather than taste.
const (
	// defaultBargeGuard matches what the reference implementation settled on
	// after live calls.
	defaultBargeGuard = 800 * time.Millisecond

	// A recording has no generated response to cancel, so an unconfirmed VAD
	// edge previously stopped it even on a brief echo or line click. Confirm
	// sustained speech for at most six RTP frames during the opening guard;
	// recognized words and keypresses still interrupt without this wait.
	recordingSpeechConfirmation = 6 * frameDurationMs * time.Millisecond

	// audibleGapSlack is how far past the end of the queued audio a new frame
	// may arrive and still continue it. Two frames covers the jitter of a model
	// streaming at real time; more silence than that is a gap the caller hears.
	audibleGapSlack = 2 * frameDurationMs * time.Millisecond

	// defaultNoInput is long enough not to talk over a caller who is thinking.
	defaultNoInput = 8 * time.Second
)

// Session is one AI call.
//
// Audio moves through it on two pumps that never block each other: caller
// audio goes up as the wire delivers it, and model audio comes down into a
// queue the RTP session drains on its own clock. Nothing here paces anything;
// pacing belongs to the leg that has to meet a deadline.
type Session struct {
	leg   Leg
	model provider.VoiceSession
	log   *slog.Logger
	// providerName labels latency measurements.
	providerName string
	// ledgerCallID is the call's ledger identity, set before Start; it keys
	// the stages of an AI outbound call's time to the first word.
	ledgerCallID uuid.UUID

	cfg         Config
	uplink      *media.Converter
	downlink    *media.Converter
	framer      *framer
	inputLevel  media.InputLeveler
	outputLevel media.OutputLeveler
	// playBuffer is reused across chunks; only the model-event pump writes it.
	playBuffer []byte

	events chan Event

	// mu guards everything to do with playback. Two goroutines reach it: the
	// model pump queues speech, and the digit pump cuts it off mid-sentence.
	mu sync.Mutex
	// framesQueued counts frames handed to the leg for the current turn. It is
	// how much the caller has heard, which is the one thing a provider cannot
	// work out for itself.
	framesQueued int
	// Retain this across interruption clears so a partially spoken reply is kept.
	turnHadQueuedAudio bool
	// Output text identifies a spoken draft without treating tool-only turns as speech.
	turnHasOutputText bool
	playbackID        string
	recordingKey      string
	// audioTurns counts the turns that finished generating with audio queued
	// for the caller. A turn that only carried a tool call has none.
	audioTurns int
	// isBotSpeaking gates barge-in: there is nothing to interrupt otherwise.
	isBotSpeaking bool
	// A successful Start of a known direct realtime session has already
	// requested its generated opening. Remember speech before that specific
	// first response, including a short utterance that ends before it starts.
	// Recorded and unknown wrappers must not claim this pending response.
	openingResponsePending bool
	openingSpeechPending   bool
	// isResponding is true from a model turn's start to its end, audio or
	// not: the stretch in which asking for another turn collides with it.
	isResponding bool
	// openTurns counts model turns started and not yet ended or interrupted
	// (capped at two). Turns end in the order they start, so an interruption
	// that arrives while another turn is open belongs to the older one: it is
	// stale, and must not take the floor from the turn that replaced it.
	openTurns int
	// isCutOff is true from a barge-in that flushed a response still being
	// generated until the next turn starts: the provider goes on streaming the
	// cancelled response for a moment (up to half a second on some engines),
	// and what arrives in that stretch belongs to a turn the caller has
	// already stopped hearing. Queued, it plays right after the flush as the
	// tail of the answer they interrupted. Every turn begins with
	// ResponseStarted, so that is where it clears. cutOffChunks counts what
	// was dropped, for the log.
	isCutOff     bool
	cutOffChunks int
	// turnOwedUntil is when an asked-for turn that has not started yet stops
	// counting as the bot's floor; zero is none. See askedForATurn.
	turnOwedUntil time.Time
	// audibleSince is when the caller started hearing the bot after the last
	// silence, which is what the barge-in guard window is measured from. It is
	// set by queueFrame when audio is queued on an idle leg, cleared when
	// playback is stopped, and not touched by a turn that follows another with
	// the queue still full: the caller has heard the bot continuously since the
	// first of them, and the line echo the guard exists for is long over.
	// audibleUntil is when the audio queued so far finishes playing, which is
	// how queueFrame tells a queue that drained from one that is being fed in
	// real time. Both are zero while nothing is audible.
	audibleSince time.Time
	audibleUntil time.Time
	// Only the model-event pump owns the confirmation timer. These markers
	// bind its pending decision to this exact recording segment and turn;
	// a stop, replacement or caller-speech end invalidates it under mu.
	recordingSpeechDeadline time.Time
	recordingSpeechPlayback string
	recordingSpeechTurn     int
	// Keep caller-speech pairing across playback changes. A repeated detector
	// edge must not turn a reported speech start into an unreported short pulse
	// whose stop would leave the flow believing the caller is still speaking.
	openingSpeechCandidate bool
	completedRecordingID   string
	callerSpeechReported   bool
	// isFirstAudioRecorded is set when the call's first speech frame has been
	// measured against the answer (queueFrame, under mu).
	isFirstAudioRecorded bool
	// timer measures caller-stopped to reply-on-the-wire, per turn.
	timer          turnTimer
	turnLatency    TurnLatencySnapshot
	activeTrace    provider.ResponseTrace
	lastModelEpoch uint64
	mediaTiming    mediaPhaseTiming
	toolTimings    map[string]toolTiming

	// Two generation counters invalidate watches already in flight. Stopping a
	// timer races with it firing; letting a stale one fire and recognise
	// itself as stale does not.
	//
	// They are separate because they answer different questions. The drain
	// watch asks "is this turn's audio still on its way to the caller?" — only
	// a new turn or a flush changes that. The idle watch asks "has the caller
	// said anything?" — speech changes that. Sharing one counter was a live
	// bug: the caller murmuring over the tail of a goodbye cancelled the
	// drain watch, PLAYBACK_DONE never fired, and every call ended on the
	// grace cap, five silent seconds late.
	drainGeneration uint64
	idleGeneration  uint64
	// turnSeq numbers model turns, so events can say which turn they belong to.
	turnSeq int
	// Once a closing turn has been chosen, later automatic responses must
	// not replace its drain marker or append another question after goodbye.
	lastAllowedTurn     int
	closingPlaybackID   string
	closingPlaybackTurn int
	discardResponse     bool
	discardTrace        provider.ResponseTrace
	discardPlaybackID   string
	// playbackDone is signalled when a turn's audio has finished generating and
	// the queue should be watched until it drains.
	playbackDone chan playbackMarker
	// afterPlaybackDone, set only by tests, runs right after PLAYBACK_DONE is
	// published and before the dead-air watch starts.
	afterPlaybackDone func()

	closeOnce sync.Once
	done      chan struct{}
	wg        sync.WaitGroup
}

// 中文注释：把单通电话的线路、模型和配置组合成独立会话。
// New bridges a dialog to a model.
//
// The audio formats come from the negotiated law and what the provider
// accepts, so a provider that takes G.711 gets the caller's bytes untouched
// and one that does not gets them converted here.
func New(leg Leg, model provider.VoiceSession, profile provider.Profile,
	cfg Config) (*Session, error) {

	if leg == nil || model == nil {
		return nil, errors.New("aicall: a session needs both a leg and a model")
	}
	log := cfg.Logger
	if log == nil {
		log = slog.Default()
	}

	law := leg.Law()
	input, output := profile.FormatsFor(law)

	uplink, err := media.NewConverter(media.G711Format(law), input)
	if err != nil {
		return nil, fmt.Errorf("aicall: caller audio to provider: %w", err)
	}
	downlink, err := media.NewConverter(output, media.G711Format(law))
	if err != nil {
		return nil, fmt.Errorf("aicall: provider audio to caller: %w", err)
	}

	return &Session{
		leg:          leg,
		model:        model,
		log:          log,
		providerName: profile.Name,
		cfg:          cfg,
		uplink:       uplink,
		downlink:     downlink,
		framer:       newFramer(law),
		playBuffer:   make([]byte, 0, 8*media.FrameSamples),
		events:       make(chan Event, 128),
		playbackDone: make(chan playbackMarker, 8),
		done:         make(chan struct{}),
	}, nil
}

// bargeGuard is how long after speech starts that detection is ignored.
func (s *Session) bargeGuard() time.Duration {
	switch {
	case s.cfg.BargeGuard < 0:
		return 0
	case s.cfg.BargeGuard == 0:
		return defaultBargeGuard
	default:
		return s.cfg.BargeGuard
	}
}

// noInputAfter is how long a silent caller counts as dead air; zero disables.
func (s *Session) noInputAfter() time.Duration {
	switch {
	case s.cfg.NoInput < 0:
		return 0
	case s.cfg.NoInput == 0:
		return defaultNoInput
	default:
		return s.cfg.NoInput
	}
}

// Events yields what happened on the call. The stream ends with a single ENDED
// event and is then closed, so it is safe to range over.
func (s *Session) Events() <-chan Event { return s.events }

// 中文注释：启动会话的媒体、模型和事件处理协程。
// Start configures the model and begins moving audio.
func (s *Session) Start(ctx context.Context) error {
	sessionCfg := s.cfg.Session
	law := s.leg.Law()
	sessionCfg.InputFormat = s.uplink.To()
	sessionCfg.OutputFormat = s.downlink.From()

	// The first-media watch always runs, for the measurement; it also opens the
	// greeting gate when the deployment asked for one. Without a gate the
	// model's start config carries none and nothing waits.
	var gate chan struct{}
	if s.cfg.IsGreetingGated {
		gate = make(chan struct{})
		sessionCfg.OpeningGate = gate
	}
	go s.watchFirstMedia(ctx, gate)

	if err := s.model.Start(ctx, sessionCfg); err != nil {
		// No telephone pumps or playback have started. Release the failed
		// provider and its first-media watcher, preserving the same caller leg
		// for the orchestrator's one permitted pre-greeting retry.
		s.closeOnce.Do(func() {
			close(s.done)
			_ = s.model.Close(context.Background())
		})
		return fmt.Errorf("aicall: start model: %w", err)
	}
	if !sessionCfg.SkipOpening {
		switch model := s.model.(type) {
		case *provider.Realtime:
			s.openingResponsePending = true
		case interface{ GeneratedOpeningRequested() bool }:
			s.openingResponsePending = model.GeneratedOpeningRequested()
		}
	}
	s.log.Info("ai call bridged",
		"law", law.String(),
		"toProvider", sessionCfg.InputFormat.String(),
		"fromProvider", sessionCfg.OutputFormat.String(),
		"isPassthrough", s.uplink.IsPassthrough())

	s.wg.Add(5)
	go s.pumpCallerAudio()
	go s.pumpModelEvents()
	go s.pumpDigits()
	go s.watchLeg()
	go s.watchPlayback()

	// Every publisher is one of those five. Once they have all returned,
	// nothing can emit any more, which is the only point at which closing the
	// stream is safe.
	go func() {
		s.wg.Wait()
		select {
		case s.events <- Event{Type: EventTypeEnded}:
		default:
		}
		close(s.events)
	}()

	s.emit(Event{Type: EventTypeReady})
	return nil
}

// watchFirstMedia measures answer-to-first-media and, when gate is not nil,
// closes it on the first of: the first inbound packet (MEDIA), the grace
// elapsing (GRACE), the leg ending or the session closing (LEG_STOPPED), or ctx
// ending (CTX). It logs which one opened the gate, once. It keeps watching
// after a grace expiry so the measurement still lands, and ends when the
// call does.
func (s *Session) watchFirstMedia(ctx context.Context, gate chan struct{}) {
	began := time.Now()
	var grace <-chan time.Time
	if gate != nil && s.cfg.GreetingMediaWait > 0 {
		timer := time.NewTimer(s.cfg.GreetingMediaWait)
		defer timer.Stop()
		grace = timer.C
	}
	open := func(reason string) {
		if gate == nil {
			return
		}
		s.log.Info("greeting gate opened", "reason", reason,
			"waitedMs", time.Since(began).Milliseconds())
		close(gate)
		gate = nil
	}
	for {
		select {
		case <-s.leg.MediaStarted():
			open("MEDIA")
			// The packet's own arrival time: media can be up long before
			// Start runs (lookup, flow load and the provider dial come first).
			if answered, arrived := s.leg.AnsweredAt(), s.leg.FirstMediaAt(); !answered.IsZero() && !arrived.IsZero() {
				ms := arrived.Sub(answered).Milliseconds()
				obs.RecordBotFirstMedia(ms)
				s.log.Info("first media", "answerToFirstMediaMs", ms)
			}
			return
		case <-grace:
			grace = nil
			open("GRACE")
		case <-s.leg.Stopped():
			open("LEG_STOPPED")
			return
		case <-s.done:
			open("LEG_STOPPED")
			return
		case <-ctx.Done():
			open("CTX")
			return
		}
	}
}

// recordFirstAudio measures the call's first speech frame against the answer,
// and says whether it was queued before any inbound media. Called from
// queueFrame under mu, once per call; every later frame costs one bool test.
func (s *Session) recordFirstAudio() {
	s.isFirstAudioRecorded = true
	obs.OutboundFirstAudio(s.ledgerCallID, time.Now())
	answered := s.leg.AnsweredAt()
	if answered.IsZero() {
		return
	}
	isBeforeMedia := true
	select {
	case <-s.leg.MediaStarted():
		isBeforeMedia = false
	default:
	}
	ms := time.Since(answered).Milliseconds()
	obs.RecordBotFirstAudio(s.providerName, ms, isBeforeMedia)
	if isBeforeMedia {
		s.log.Warn("first bot audio queued before any inbound media: the caller cannot have heard it",
			"answerToFirstAudioMs", ms, "isBeforeMedia", true)
		return
	}
	s.log.Info("first bot audio", "answerToFirstAudioMs", ms, "isBeforeMedia", false)
}

// Close ends the call from this side and releases both halves.
func (s *Session) Close(ctx context.Context) {
	s.closeOnce.Do(func() {
		close(s.done)
		s.mu.Lock()
		s.turnOwedUntil = time.Time{}
		s.recordingSpeechDeadline = time.Time{}
		s.mu.Unlock()
		_ = s.model.Close(ctx)
		s.leg.Stop()
	})
}

// isClosed reports whether Close has been called.
func (s *Session) isClosed() bool {
	select {
	case <-s.done:
		return true
	default:
		return false
	}
}

// Wait blocks until every pump has stopped.
func (s *Session) Wait() { s.wg.Wait() }

//
// Conversation control, for the flow engine.
//

// AnswerTool replies to a tool call and steers the next turn.
func (s *Session) AnswerTool(toolCallID, output, hint string) error {
	started := time.Now()
	err := s.model.SendToolResult(toolCallID, output, hint)
	s.toolResultWritten(toolCallID, started, err)
	if err != nil {
		return err
	}
	s.askedForATurn()
	return nil
}

// AcknowledgeTool records a result without asking for or owing another turn.
func (s *Session) AcknowledgeTool(callID, output string) error {
	if c, ok := s.model.(interface{ AcknowledgeTool(string, string) error }); ok {
		started := time.Now()
		err := c.AcknowledgeTool(callID, output)
		s.toolResultWritten(callID, started, err)
		return err
	}
	return fmt.Errorf("silent tool acknowledgement unavailable")
}

// SendCue sends the model a text it answers with a turn of its own: a
// dead-air check, a goodbye, a keypress.
func (s *Session) SendCue(text string) error {
	if err := s.model.SendUserText(text); err != nil {
		return err
	}
	s.askedForATurn()
	return nil
}

// askedForATurn records that the model owes a turn which has not started: a
// tool result or a cue was just sent, and the provider's answer begins one
// round trip later (ResponseStarted). In that gap nothing else says the bot
// holds the floor, and a cue sent then is refused ("already has an active
// response") on the Realtime providers.
//
// The claim expires after actionGraceCap so a turn that never comes (a
// provider that answers a result with silence) cannot pin the floor: the
// caller of isHoldingTheFloor has its own backstop as well.
func (s *Session) askedForATurn() {
	s.mu.Lock()
	s.turnOwedUntil = time.Now().Add(actionGraceCap)
	s.mu.Unlock()
}

// Reinstruct replaces the standing instructions, which is how a flow moves the
// conversation between phases.
func (s *Session) Reinstruct(text string) error {
	return s.model.UpdateInstructions(text)
}

// 中文注释：将会话标记为在指定轮次后收尾。
func (s *Session) SealAfterTurn(turn int) {
	s.mu.Lock()
	if s.lastAllowedTurn == 0 {
		s.lastAllowedTurn = turn
	}
	s.mu.Unlock()
}

func (s *Session) isEnding() bool {
	return s.cfg.IsEndingArmed != nil && s.cfg.IsEndingArmed()
}

type recordingController interface {
	InterruptRecording(string, provider.InterruptReason, int) error
	ActiveRecording() string
	PausedRecording() string
	ResumeRecording() (string, error)
	DiscardRecording()
	RecordingPlayed(string)
}

// ActiveRecording reports the current unpaused recording segment, if any.
// It is used by the flow to defer semantic decisions until a final transcript
// is available without confusing a paused segment with live playback.
func (s *Session) ActiveRecording() string {
	if control, ok := s.model.(recordingController); ok {
		return control.ActiveRecording()
	}
	return ""
}

// BargeInForSpeech applies the normal speech interruption path after the flow
// has classified the customer's final transcript as substantive.
func (s *Session) BargeInForSpeech() { s.bargeIn(provider.InterruptReasonSpeech) }

func (s *Session) PausedRecording() string {
	if control, ok := s.model.(recordingController); ok {
		return control.PausedRecording()
	}
	return ""
}
func (s *Session) ResumeRecording() (string, error) {
	s.mu.Lock()
	s.recordingSpeechDeadline = time.Time{}
	s.mu.Unlock()
	if control, ok := s.model.(recordingController); ok {
		return control.ResumeRecording()
	}
	return "", nil
}
func (s *Session) DiscardRecording() {
	s.mu.Lock()
	s.recordingSpeechDeadline = time.Time{}
	s.mu.Unlock()
	if control, ok := s.model.(recordingController); ok {
		control.DiscardRecording()
	}
}

type replyController interface {
	HoldReply() error
	GuideReply(string) error
	ReleaseReply()
}

func (s *Session) ReleaseReply() {
	if control, ok := s.model.(replyController); ok {
		control.ReleaseReply()
	}
}

// HoldReply stops audible speech as well as model generation. The customer's
// audio and transcripts keep flowing while they finish their thought.
func (s *Session) HoldReply() error {
	control, ok := s.model.(replyController)
	if !ok {
		return errors.New("provider cannot hold a reply")
	}
	if err := control.HoldReply(); err != nil {
		return err
	}
	s.bargeIn(provider.InterruptReasonSystem)
	return nil
}

// A review belongs to the response it inspected. It cannot hold a later
// response merely because the actor caught up after that response started.
func (s *Session) HoldReplyForTurn(turn int) (bool, error) {
	s.mu.Lock()
	if s.turnSeq != turn {
		s.mu.Unlock()
		return false, nil
	}
	trace := s.activeTrace
	s.mu.Unlock()
	control, ok := s.model.(interface {
		HoldReplyResponse(provider.ResponseTrace) (bool, error)
	})
	if !ok {
		return false, errors.New("targeted reply control unavailable")
	}
	held, err := control.HoldReplyResponse(trace)
	if held && err == nil {
		s.bargeInForTurn(provider.InterruptReasonSystem, turn)
	}
	return held, err
}

// GuideReply resumes from the latest real customer context without inserting
// a fake customer utterance or replaying the interrupted question.
func (s *Session) GuideReply(hint string) error {
	control, ok := s.model.(replyController)
	if !ok {
		return errors.New("provider cannot guide a reply")
	}
	s.bargeIn(provider.InterruptReasonSystem)
	if err := control.GuideReply(hint); err != nil {
		return err
	}
	s.askedForATurn()
	return nil
}

func (s *Session) GuideReplyForTurn(turn int, hint string) (bool, error) {
	s.mu.Lock()
	if s.turnSeq != turn {
		s.mu.Unlock()
		return false, nil
	}
	trace := s.activeTrace
	s.mu.Unlock()
	control, ok := s.model.(interface {
		GuideReplyResponse(provider.ResponseTrace, string) (bool, error)
	})
	if !ok {
		return false, errors.New("targeted reply guidance unavailable")
	}
	s.bargeInForTurn(provider.InterruptReasonSystem, turn)
	requested, err := control.GuideReplyResponse(trace, hint)
	if requested && err == nil {
		s.askedForATurn()
	}
	return requested, err
}

func (s *Session) ResolveDirectReply(text string, trace provider.ResponseTrace) bool {
	if s.isClosed() {
		return false
	}
	if c, ok := s.model.(interface {
		ResolveDirectReply(string, provider.ResponseTrace) bool
	}); ok {
		handled := c.ResolveDirectReply(text, trace)
		if handled {
			s.askedForATurn()
		}
		return handled
	}
	return false
}
func (s *Session) EnsureReplyIfIdle(hint string) (bool, error) {
	if s.isClosed() || s.HasOutput() {
		return false, nil
	}
	control, ok := s.model.(interface{ EnsureReplyIfIdle(string) (bool, error) })
	if !ok {
		return false, errors.New("provider cannot ensure an idle reply")
	}
	requested, err := control.EnsureReplyIfIdle(hint)
	if requested && err == nil {
		s.askedForATurn()
	}
	return requested, err
}

// Speak says a line the flow chose, in the words it chose.
//
// The counterpart to Reinstruct: that one changes what the model is working
// towards, this one is the sentence itself. It pre-empts whatever is being
// said and does not queue behind anything — see provider.VoiceSession — so a
// phase whose whole job is one line gets that line out, not a paraphrase of it
// two turns later.
//
// The opening line of a call is not sent through here. It travels in the
// session configuration, because the first turn is asked for while the session
// is being started and there is no mid-call moment to catch.
//
// isClosing says the line ends the call (provider.VoiceSession.SpeakText).
func (s *Session) Speak(text string, isClosing bool) error {
	if control, ok := s.model.(interface{ SpeakClosing(string, string) error }); ok && isClosing {
		id := "closing-speech-" + uuid.NewString()
		s.mu.Lock()
		s.closingPlaybackID = id
		s.mu.Unlock()
		s.bargeIn(provider.InterruptReasonSystem)
		return control.SpeakClosing(text, id)
	}
	return s.model.SpeakText(text, isClosing)
}

// ClosingPlaybackMatches prevents an older drain receipt from hanging up a
// committed local farewell before its own audio has actually played.
func (s *Session) ClosingPlaybackMatches(turn int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closingPlaybackID == "" || s.closingPlaybackTurn == turn
}

// SpeakFixed is optional: models without a separate synthesizer continue to
// use Speak. A busy floor is reported without pre-empting the customer.
func (s *Session) SpeakFixed(text string) (supported, started bool, err error) {
	control, ok := s.model.(interface{ SpeakFixed(string) (bool, error) })
	if !ok {
		return false, false, nil
	}
	started, err = control.SpeakFixed(text)
	return true, started, err
}

//
// Audio.
//

// pumpCallerAudio moves the caller's voice to the model.
func (s *Session) pumpCallerAudio() {
	defer s.wg.Done()

	frames := s.leg.Frames()
	converted := make([]byte, 0, media.FrameSamples*8)

	for {
		select {
		case <-s.done:
			return
		case frame, ok := <-frames:
			if !ok {
				return
			}
			if s.isEnding() {
				// Let the closing audio drain. Background sound or a late
				// acknowledgement cannot ask the model for a fresh response.
				media.PutBytes(frame)
				continue
			}
			converted = s.uplink.Convert(converted, frame)
			media.PutBytes(frame)
			if s.cfg.ObserveInbound != nil {
				s.cfg.ObserveInbound(converted, s.uplink.To())
			}
			if s.cfg.Audio.EnhanceQuietSpeech || s.cfg.Audio.NoiseReduction == "mild" {
				s.inputLevel.Process(converted, s.uplink.To(), s.cfg.Audio)
			}

			if err := s.model.SendAudio(converted); err != nil {
				// A model that cannot be fed is a call that cannot continue.
				// Nothing names this one: a socket that stopped taking audio
				// has not said why.
				s.fail("the model stopped accepting audio", err, "")
				return
			}
		}
	}
}

// playAudio converts one chunk of model speech and queues it on the leg.
func (s *Session) playAudio(audio []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isCutOff {
		s.cutOffChunks++
		return
	}
	if !s.isBotSpeaking {
		s.isBotSpeaking = true
	}
	startedAt := time.Now()
	if s.mediaTiming.firstAudioAt.IsZero() {
		s.mediaTiming.firstAudioAt = startedAt
	}
	if s.timer.customerTurn == s.activeTrace.CustomerTurn && (s.playbackID == "" || s.recordingKey == provider.FixedFollowUpRecordingKey) {
		s.timer.onFirstAudio()
	}
	if s.playbackID == "" || s.recordingKey == provider.FixedFollowUpRecordingKey {
		audio = s.outputLevel.Process(audio, s.downlink.From())
	}
	audio = media.Volume(audio, s.downlink.From(), s.cfg.Audio.Volume)
	conversionAt := time.Now()
	s.playBuffer = s.downlink.Convert(s.playBuffer, audio)
	convertedAt := time.Now()
	s.mediaTiming.processingTime += conversionAt.Sub(startedAt)
	s.mediaTiming.conversionTime += convertedAt.Sub(conversionAt)
	s.mediaTiming.chunks++
	s.framer.push(s.playBuffer, s.queueFrame)
}

// queueFrame hands one frame to the leg and counts it as heard. The caller
// holds mu.
//
// A frame the leg refuses means the model is producing faster than real time
// by more than the queue can hold — several seconds of audio. That is a
// runaway response, and dropping the overflow beats growing without bound.
//
// This is also where the caller starts hearing the bot. The barge-in guard is
// measured from the first frame queued on an idle leg, not from each turn's
// first chunk: a turn queued behind another's tail is not the start of
// anything the caller notices, and a turn whose audio sits in the queue has
// not started to be heard until it reaches the front. A frame on an empty
// queue is a new start only if the audio queued before it has finished
// playing, because a model streaming in real time finds the queue empty before
// almost every frame without the caller ever hearing silence. The clock is read
// only on an empty queue, which keeps the hot path free of it.
func (s *Session) queueFrame(frame []byte) {
	isIdle := s.leg.Pending() == 0
	firstFrame := !s.mediaTiming.firstFrameSeen
	var sent bool
	if observed, ok := s.leg.(interface {
		SendObserved([]byte, *slog.Logger) bool
	}); ok && firstFrame {
		log := s.log.With(s.activeTrace.LogAttrs()...).With("turn", s.turnSeq, "playbackId", s.playbackID)
		sent = observed.SendObserved(frame, log)
	} else {
		sent = s.leg.Send(frame)
	}
	if !sent {
		s.log.Warn("dropped model audio: the send queue is full")
		return
	}
	if firstFrame {
		s.mediaTiming.firstFrameSeen = true
		s.log.Info("voice phase", append(s.activeTrace.LogAttrs(), "phase", "first_frame_queued", "stageAt", time.Now().UTC(), "turn", s.turnSeq,
			"firstAudioToFrameUs", time.Since(s.mediaTiming.firstAudioAt).Microseconds(),
			"mediaProcessingUs", s.mediaTiming.processingTime.Microseconds(), "resampleAndG711Us", s.mediaTiming.conversionTime.Microseconds(),
			"queueDepthFrames", s.leg.Pending(), "frameDurationMs", frameDurationMs)...)
	}
	if isIdle {
		now := time.Now()
		if s.audibleSince.IsZero() || now.After(s.audibleUntil.Add(audibleGapSlack)) {
			s.audibleSince = now
			s.audibleUntil = now
		}
	}
	if !s.audibleSince.IsZero() {
		s.audibleUntil = s.audibleUntil.Add(frameDurationMs * time.Millisecond)
	}
	s.framesQueued++
	s.turnHadQueuedAudio = true
	if !s.isFirstAudioRecorded {
		s.recordFirstAudio()
	}
	sameCustomer := s.timer.customerTurn == s.activeTrace.CustomerTurn && (s.playbackID == "" || s.recordingKey == provider.FixedFollowUpRecordingKey)
	if sameCustomer {
		if totalMs, providerMs, ok := s.timer.onFirstFrame(); ok {
			s.turnLatency.Samples++
			s.turnLatency.LastTotalMs = totalMs
			s.turnLatency.MaxTotalMs = max(s.turnLatency.MaxTotalMs, totalMs)
			s.turnLatency.LastProviderMs = nil
			if s.timer.firstAudioSeen {
				s.turnLatency.LastProviderMs = &providerMs
			}
			recordTurnLatency(s.log.With(s.activeTrace.LogAttrs()...), s.providerName, totalMs, providerMs)
		}
	}
}

//
// Model events.
//

func (s *Session) pumpModelEvents() {
	defer s.wg.Done()
	// The model going away ends the call: the other pumps have no reason to
	// keep running, and the caller should not be left holding a live line with
	// nothing on the other end.
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		s.Close(ctx)
	}()

	var recordingSpeechTimer *time.Timer
	defer func() {
		if recordingSpeechTimer != nil {
			recordingSpeechTimer.Stop()
		}
	}()
	for {
		var recordingSpeech <-chan time.Time
		if wait, pending := s.recordingSpeechWait(); pending {
			if recordingSpeechTimer == nil {
				recordingSpeechTimer = time.NewTimer(wait)
			} else {
				if !recordingSpeechTimer.Stop() {
					select {
					case <-recordingSpeechTimer.C:
					default:
					}
				}
				recordingSpeechTimer.Reset(wait)
			}
			recordingSpeech = recordingSpeechTimer.C
		} else if recordingSpeechTimer != nil {
			recordingSpeechTimer.Stop()
		}
		select {
		case <-s.done:
			return
		case <-recordingSpeech:
			if s.confirmRecordingSpeech() && !s.isEnding() {
				s.bargeIn(provider.InterruptReasonSpeech)
				s.reportSpeechStarted()
			}
		case event, ok := <-s.model.Events():
			if !ok {
				return
			}
			s.handleModelEvent(event)
		}
	}
}

// 中文注释：把模型事件转换为当前会话的文本、音频、工具及轮次状态。
func (s *Session) handleModelEvent(event provider.Event) {
	if s.isEnding() && (event.Type == provider.EventTypeSpeechStarted || event.Type == provider.EventTypeSpeechStopped || event.Type == provider.EventTypeInputTranscript) {
		return
	}
	s.mu.Lock()
	responseEvent := event.Type == provider.EventTypeAudioDelta || event.Type == provider.EventTypeOutputTranscript || event.Type == provider.EventTypeResponseDone || event.Type == provider.EventTypeInterrupted || event.Type == provider.EventTypeToolCall
	if s.closingPlaybackID != "" && (responseEvent || event.Type == provider.EventTypeResponseStarted) && event.PlaybackID != s.closingPlaybackID {
		s.mu.Unlock()
		return
	}
	discard := responseEvent && s.discardResponse && event.Trace.SameResponse(s.discardTrace) && event.PlaybackID == s.discardPlaybackID
	if discard {
		if event.Type == provider.EventTypeResponseDone || event.Type == provider.EventTypeInterrupted {
			s.discardResponse = false
		}
		s.mu.Unlock()
		return
	}
	if responseEvent && !event.Trace.SameResponse(s.activeTrace) {
		s.mu.Unlock()
		s.log.Info("ignored stale call response event", append(event.Trace.LogAttrs(), "type", event.Type)...)
		return
	}
	if event.Type == provider.EventTypeResponseStarted && event.Trace.ResponseEpoch != 0 {
		if event.Trace.ResponseEpoch <= s.lastModelEpoch {
			s.mu.Unlock()
			s.log.Info("ignored stale call response start", event.Trace.LogAttrs()...)
			return
		}
		s.lastModelEpoch = event.Trace.ResponseEpoch
	}
	if s.turnSeq == 0 && (event.Type == provider.EventTypeInterrupted || event.Type == provider.EventTypeResponseDone) {
		// A provider may finish/cancel the requested opening before a usable
		// response-start event reaches us. Its successor is then the caller's
		// first answer, so an old opening interruption must not cancel it.
		s.openingResponsePending, s.openingSpeechPending = false, false
	}
	if event.Type == provider.EventTypeResponseStarted && s.lastAllowedTurn > 0 && s.turnSeq >= s.lastAllowedTurn && !(s.closingPlaybackID != "" && event.PlaybackID == s.closingPlaybackID) {
		s.discardResponse = true
		s.discardTrace, s.discardPlaybackID = event.Trace, event.PlaybackID
		s.mu.Unlock()
		s.log.Info("suppressed a response after the closing turn")
		if control, ok := s.model.(interface {
			InterruptResponse(provider.ResponseTrace, provider.InterruptReason, int) error
		}); ok && event.Trace.ResponseEpoch != 0 {
			_ = control.InterruptResponse(event.Trace, provider.InterruptReasonSystem, -1)
		} else {
			_ = s.model.Interrupt(provider.InterruptReasonSystem, -1)
		}
		return
	}
	s.mu.Unlock()
	if event.PlaybackID != "" && event.Type != provider.EventTypeResponseStarted {
		s.mu.Lock()
		current := s.playbackID
		s.mu.Unlock()
		if current != event.PlaybackID {
			s.mu.Lock()
			completed := s.completedRecordingID
			s.mu.Unlock()
			if event.Type != provider.EventTypeOutputTranscript || !event.IsFinal || event.RecordingKey == "" || event.PlaybackID != completed {
				return
			}
		}
	}
	switch event.Type {
	case provider.EventTypeAudioDelta:
		s.playAudio(event.Audio)

	case provider.EventTypeSpeechStarted:
		// The caller is talking, so there is no dead air to report whether or
		// not this turns out to be a real interruption.
		s.cancelDeadAirWatch()
		openingRecording := s.ActiveRecording() == "opening-recordings"
		s.mu.Lock()
		if s.turnSeq == 0 && s.openingResponsePending {
			s.openingSpeechPending = true
		}
		s.timer.onSpeechStarted()
		s.openingSpeechCandidate = openingRecording
		if openingRecording {
			s.recordingSpeechDeadline = time.Time{}
		}
		s.mu.Unlock()
		if openingRecording {
			// A VAD edge is only a candidate while the fixed opening is playing.
			// The flow will decide after the final transcript whether to pause it.
			s.reportSpeechStarted()
			s.log.Info("held speech candidate during opening recording")
			break
		}
		if s.deferRecordingSpeech() {
			// Do not start the flow's recognition timeout for a detector pulse
			// that may disappear before it represents customer speech.
			break
		}
		s.bargeIn(provider.InterruptReasonSpeech)
		s.reportSpeechStarted()

	case provider.EventTypeSpeechStopped:
		s.mu.Lock()
		pendingRecordingSpeech := s.recordingSpeechDeadline
		speechWasReported := s.callerSpeechReported
		s.callerSpeechReported = false
		s.recordingSpeechDeadline = time.Time{}
		s.timer.onSpeechStopped()
		s.timer.customerTurn = event.Trace.CustomerTurn
		s.mu.Unlock()
		if !pendingRecordingSpeech.IsZero() && !speechWasReported && time.Now().Before(pendingRecordingSpeech) {
			s.log.Info("ignored a brief unconfirmed recording speech pulse")
			break
		}
		if !pendingRecordingSpeech.IsZero() && !speechWasReported {
			// The stop event and timer can both be ready. Do not lose sustained
			// speech merely because the pump selected the stop event first.
			s.bargeIn(provider.InterruptReasonSpeech)
			s.emit(Event{Type: EventTypeSpeechStarted, Turn: s.currentTurn()})
		}
		s.emit(Event{Type: EventTypeSpeechStopped, Turn: s.currentTurn()})

	case provider.EventTypeInterrupted:
		s.mu.Lock()
		localRecording := s.playbackID != ""
		s.mu.Unlock()
		if localRecording && event.PlaybackID == "" {
			// A remote model cancellation has no ownership of local recorded
			// audio. Recorded normally filters it, but a wrapper transition must
			// not bypass speech confirmation or decrement the recording's turn.
			// Actual recording cancellation carries its matching playback ID.
			s.log.Debug("ignored remote cancellation while a recording owns playback")
			return
		}
		// The provider confirming a turn was cut short. It may have decided
		// that on its own, so this doubles as a backstop: whatever the reason,
		// the caller must not keep hearing the abandoned answer.
		//
		//
		// A provider that cancels a response and starts another can report the
		// cancellation after the new turn has begun.
		isCurrent := s.endInterruptedTurn()
		if !isCurrent {
			// The replaced response was already stopped before this turn
			// began. Its late acknowledgement must not flush, truncate or
			// publish an interrupted completion for the new response.
			s.log.Debug("ignored cancellation of a replaced response")
			return
		}
		//
		// Cancelling is not trimming. A provider that stops on its own knows
		// it stopped, and still has no idea how much of what it produced ever
		// reached the caller — only this side counts frames. When we have
		// already flushed, this is a no-op: nothing was queued, so nothing
		// was heard, so there is nothing to say.
		//
		// "Nothing was queued" is not "nothing was heard": a turn whose audio
		// sat behind an earlier turn's tail and was flushed unplayed has
		// played 0 ms and must be trimmed to 0, or the model's history keeps
		// an answer nobody received. Only a turn with no queued audio at all
		// (already flushed by a barge-in) stays silent.
		localFixedSpeech := event.RecordingKey == provider.FixedFollowUpRecordingKey
		if playedMs, hadQueued := s.stopPlayback(isCurrent); hadQueued && !localFixedSpeech {
			// Said out loud for the same reason the caller-initiated case is:
			// an interruption that leaves no trace cannot be told apart
			// afterwards from one that never happened. This path reports the
			// provider's own decision, so it names who decided.
			s.log.Info("the provider took the floor back",
				"reason", string(event.InterruptedBy), "playedMs", playedMs)
			s.tellTheModelWhatWasHeard(event.Trace, event.PlaybackID, event.InterruptedBy, playedMs)
		}
		if localFixedSpeech {
			if control, ok := s.model.(interface{ CancelFixedSpeech(string) }); ok {
				control.CancelFixedSpeech(event.PlaybackID)
			}
		}
		s.emit(Event{Type: EventTypeTurnDone, Trace: event.Trace, Status: event.Status,
			Usage: event.Usage, Turn: s.currentTurn(), IsInterrupted: true})

	case provider.EventTypeResponseStarted:
		s.mu.Lock()
		s.beginTurnLocked()
		if s.closingPlaybackID != "" && event.PlaybackID == s.closingPlaybackID {
			s.closingPlaybackTurn = s.turnSeq
		}
		s.activeTrace, s.mediaTiming = event.Trace, mediaPhaseTiming{}
		s.playbackID, s.recordingKey = event.PlaybackID, event.RecordingKey
		s.outputLevel.BeginTurn()
		if event.PlaybackID != "" || event.Trace.ResponseEpoch != 0 {
			s.openTurns = 1
		}
		// Start already requested this generated opening before the caller's
		// audio pump began. Speech that happened while it was pending must
		// suppress that opening even if the short utterance has since ended.
		// A SkipOpening session or recorded wrapper never sets this marker, so
		// its legitimate first answer is not mistaken for an overdue greeting.
		interruptOpening := s.turnSeq == 1 && event.PlaybackID == "" && s.openingResponsePending && s.openingSpeechPending
		s.openingResponsePending = false
		s.openingSpeechPending = false
		s.mu.Unlock()
		if interruptOpening {
			s.bargeIn(provider.InterruptReasonSpeech)
		}

	case provider.EventTypeResponseDone:
		s.endTurn()
		s.emit(Event{Type: EventTypeTurnDone, Trace: event.Trace, Status: event.Status,
			Usage: event.Usage, Turn: s.currentTurn()})

	case provider.EventTypeInputTranscript:
		// Some providers deliver a final transcript without usable VAD events.
		// Fixed opening audio stays live until the flow classifies this text;
		// other recorded answers retain the immediate interruption behavior.
		activeRecording := s.ActiveRecording()
		recording := activeRecording != ""
		openingRecording := activeRecording == "opening-recordings"
		s.mu.Lock()
		duringOpening := openingRecording || s.openingSpeechCandidate
		if event.IsFinal {
			s.openingSpeechCandidate = false
		}
		confirmedRecordingSpeech := recording && event.IsFinal && strings.TrimSpace(event.Text) != "" && !s.recordingSpeechDeadline.IsZero()
		if event.IsFinal && strings.TrimSpace(event.Text) != "" {
			s.recordingSpeechDeadline = time.Time{}
		}
		s.mu.Unlock()
		if recording && !openingRecording && event.IsFinal && strings.TrimSpace(event.Text) != "" {
			s.bargeIn(provider.InterruptReasonSpeech)
		}
		if confirmedRecordingSpeech {
			s.reportSpeechStarted()
		}
		s.emit(Event{Type: EventTypeCustomerSaid, Trace: event.Trace, Text: event.Text, IsFinal: event.IsFinal, DuringOpening: duringOpening})

	case provider.EventTypeOutputTranscript:
		if strings.TrimSpace(event.Text) != "" {
			s.mu.Lock()
			s.turnHasOutputText = true
			s.mu.Unlock()
		}
		// The turn rides along so the line can be judged with the tool calls
		// of its own response (claimWatch).
		s.emit(Event{Type: EventTypeBotSaid, Trace: event.Trace, Text: event.Text, IsFinal: event.IsFinal,
			Turn: s.currentTurn()})

	case provider.EventTypeToolCall:
		s.toolStarted(event)
		s.emit(Event{
			Type: EventTypeToolCall, Trace: event.Trace, ToolCallID: event.ToolCallID,
			ToolName: event.ToolName, ToolArgs: event.ToolArgs,
			Turn: s.currentTurn(),
		})

	case provider.EventTypeError:
		if event.IsFatal {
			obs.RecordProviderError(s.providerName)
			if event.FailureCause == provider.FailureCauseSessionExpired {
				// Counted as well as, never instead of: this is still a session
				// that ended on an error, and an operator watching that total
				// should not have to know which engines cap a session to read
				// it. The second counter is what separates a limit reached from
				// a fault to fix.
				obs.RecordProviderSessionExpired(s.providerName)
			}
			s.fail(event.Text, event.Err, event.FailureCause)
			return
		}
		s.log.Warn("model reported a recoverable error", "error", event.Err)

	case provider.EventTypeClosed:
		s.log.Info("model session closed")
	}
}

//
// Barge-in.
//

// deferRecordingSpeech rejects only very short, unconfirmed detector edges
// while an original recording has just become audible. It does not hold
// inbound audio or transcripts, and a transcript immediately takes the floor.
// The existing pump checks the deadline, so there is no timer goroutine that
// could publish after the session's event stream has closed.
func (s *Session) deferRecordingSpeech() bool {
	guard := s.bargeGuard()
	if guard <= 0 {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.callerSpeechReported || s.playbackID == "" || s.audibleSince.IsZero() || s.framesQueued == 0 {
		return false
	}
	if !s.recordingSpeechDeadline.IsZero() && s.recordingSpeechPlayback == s.playbackID && s.recordingSpeechTurn == s.turnSeq {
		return true
	}
	remaining := guard - time.Since(s.audibleSince)
	if remaining <= 0 {
		return false
	}
	wait := min(recordingSpeechConfirmation, remaining)
	s.recordingSpeechDeadline = time.Now().Add(wait)
	s.recordingSpeechPlayback, s.recordingSpeechTurn = s.playbackID, s.turnSeq
	s.log.Info("confirming speech over a newly audible recording",
		"confirmMs", wait.Milliseconds(), "turn", s.turnSeq)
	return true
}

func (s *Session) recordingSpeechWait() (time.Duration, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recordingSpeechDeadline.IsZero() {
		return 0, false
	}
	return max(time.Until(s.recordingSpeechDeadline), 0), true
}

func (s *Session) confirmRecordingSpeech() bool {
	if s.isClosed() {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	deadline := s.recordingSpeechDeadline
	if deadline.IsZero() || time.Now().Before(deadline) {
		return false
	}
	s.recordingSpeechDeadline = time.Time{}
	return s.recordingSpeechPlayback != "" && s.recordingSpeechPlayback == s.playbackID && s.recordingSpeechTurn == s.turnSeq
}

func (s *Session) reportSpeechStarted() {
	s.mu.Lock()
	if s.callerSpeechReported {
		s.mu.Unlock()
		return
	}
	s.callerSpeechReported = true
	turn := s.turnSeq
	s.mu.Unlock()
	s.emit(Event{Type: EventTypeSpeechStarted, Turn: turn})
}

// bargeIn hands the floor back to the caller.
//
// The local queue is flushed first and the provider told second: flushing is
// what the caller actually notices, and it is the only part that cannot be
// done by anyone else. About two frames are already in flight, so the caller
// hears silence within roughly forty milliseconds.
func (s *Session) bargeIn(reason provider.InterruptReason) {
	s.bargeInForTurn(reason, 0)
}

// 中文注释：仅在目标轮次仍匹配时执行打断，并处理已播进度与后续状态。
func (s *Session) bargeInForTurn(reason provider.InterruptReason, expectedTurn int) {
	if s.isEnding() && (reason == provider.InterruptReasonSpeech || reason == provider.InterruptReasonDTMF) {
		return
	}
	s.mu.Lock()
	if expectedTurn != 0 && expectedTurn != s.turnSeq {
		s.mu.Unlock()
		return
	}
	turn, trace, playbackID := s.turnSeq, s.activeTrace, s.playbackID
	isSpeaking := s.isBotSpeaking
	isGenerating := s.isResponding
	isRecording := s.ActiveRecording() != ""
	audibleFor := time.Since(s.audibleSince)
	// Generation ending is not the caller's experience ending: the tail of
	// the utterance is still queued and playing after the model has finished
	// producing it. Speech over that tail is as much an interruption as
	// speech over the generation — the boundary is the last frame heard, not
	// the last frame made.
	pendingFrames := s.leg.Pending()
	isAudioInFlight := s.framesQueued > 0 && pendingFrames > 0
	// With a cloned voice the model may already be producing text while TTS
	// has not supplied its first frame. There is no audible bot speech to echo
	// yet, but its generation must still yield to the caller.
	isPreAudioInterruption := reason == provider.InterruptReasonSpeech && isGenerating && s.framesQueued == 0 && pendingFrames == 0
	// A system guard may reject the text before the cloned voice produces
	// its first frame. This is a known unheard spoken draft, not a tool-only
	// response or an original recording whose playback has its own identity.
	isUnheardSystemReply := reason == provider.InterruptReasonSystem && isGenerating && !isRecording && s.turnHasOutputText && !s.turnHadQueuedAudio && pendingFrames == 0
	s.mu.Unlock()

	// A keypress takes the floor even while a turn is only being generated.
	// Speech must do the same before the first audible frame: otherwise a TTS
	// response continues over a caller who spoke during synthesis. Once audio
	// has begun, keep the existing protection against a handset's echo.
	isKeyOverGeneration := (reason == provider.InterruptReasonDTMF || reason == provider.InterruptReasonSystem || isRecording) && isGenerating
	if !isSpeaking && !isAudioInFlight && !isKeyOverGeneration && !isPreAudioInterruption {
		return
	}

	// A keypress is unambiguous and always takes the floor. Detected speech is
	// not: for the first moments of a turn, what the detector hears is very
	// often the bot's own voice returning down the line, and acting on it makes
	// the bot interrupt itself mid-sentence.
	if reason == provider.InterruptReasonSpeech && !isRecording && !isPreAudioInterruption {
		if guard := s.bargeGuard(); guard > 0 && audibleFor < guard {
			// Info, not Debug: a swallowed interruption is invisible from the
			// outside, and the call log has to be able to tell it from speech
			// that was never detected.
			s.log.Info("ignored speech detected inside the barge-in guard",
				"speakingForMs", audibleFor.Milliseconds(),
				"guardMs", guard.Milliseconds())
			return
		}
	}

	// Before the flush: it empties the queue this measures.
	s.mu.Lock()
	if s.turnSeq != turn {
		s.mu.Unlock()
		return
	}
	unplayed := s.queuedPlayout()
	playedMs, hadQueued := s.stopPlaybackLocked(true)
	if isGenerating {
		// A response is still open on the provider's side and will go on
		// sending audio until the cancel takes effect. With none open (speech
		// over a finished turn's tail) nothing more is coming, and fencing
		// would only wait for a turn that has nothing to clear it but the next
		// legitimate one.
		s.isCutOff = true
	}
	s.mu.Unlock()
	if isPreAudioInterruption || isUnheardSystemReply {
		// No frame of this response reached the caller. The realtime model may
		// already have a spoken item whose audio the cloned-voice layer muted;
		// report the known zero so that item is truncated instead of retained
		// as a greeting or answer the caller supposedly heard.
		playedMs = 0
	} else if !hadQueued && !isRecording {
		// Nothing of this turn ever reached the leg, so there is no audio the
		// caller could have heard and nothing in the model's history to trim.
		// Negative is "not known": the provider cancels the response and
		// truncates nothing, rather than aiming a truncate at an item with no
		// audio in it.
		playedMs = -1
	}
	// The provider is told whenever the caller stopped hearing something, not
	// only while it was still producing. Its history is a record of what was
	// said to the caller, and an utterance the caller never heard has to come
	// out of it either way — otherwise the next turn is built on the model
	// believing it said something nobody received.
	//
	// This used to be gated on generation still being in progress, to avoid
	// cancelling a response that had already ended. That protection now lives
	// where the truth is (Realtime.Interrupt knows whether a response is
	// open), because the two are not the same question: speech over the tail
	// of a finished turn still needs the history trimmed.
	s.tellTheModelWhatWasHeard(trace, playbackID, reason, playedMs)
	// Said out loud here and nowhere else. The line above this one used to be
	// the only place an interruption was mentioned, and it was the *ignored*
	// case — a Debug line for speech that turned out to be echo — so the
	// interruptions that happened left no trace at all and the ones that did
	// not left one.
	s.log.Info("the caller took the floor back",
		"reason", string(reason), "playedMs", playedMs, "wasGenerating", isGenerating,
		"beforeFirstAudio", isPreAudioInterruption || isUnheardSystemReply)
	obs.RecordBotInterruption(string(reason))
	s.emit(Event{Type: EventTypeBargeIn, Trace: trace, Turn: turn, Text: string(reason), Unplayed: unplayed})
}

// 中文注释：把本轮实际已播放进度反馈给模型，用于对齐被打断后的上下文。
// tellTheModelWhatWasHeard reports the interruption and how much of the turn
// reached the caller, so the provider's history matches the conversation that
// actually happened.
func (s *Session) tellTheModelWhatWasHeard(trace provider.ResponseTrace, id string, reason provider.InterruptReason, playedMs int) {
	var err error
	if control, ok := s.model.(recordingController); ok && id != "" && control.ActiveRecording() != "" {
		err = control.InterruptRecording(id, reason, playedMs)
	} else if control, ok := s.model.(interface {
		InterruptResponse(provider.ResponseTrace, provider.InterruptReason, int) error
	}); ok && trace.ResponseEpoch != 0 {
		err = control.InterruptResponse(trace, reason, playedMs)
	} else {
		err = s.model.Interrupt(reason, playedMs)
	}
	if err != nil {
		s.log.Warn("could not tell the model it was interrupted", "error", err)
	}
}

// stopPlayback drops queued speech and reports how much the caller heard, and
// whether the turn had queued any audio at all. Zero milliseconds with
// hadQueued set means the whole turn was flushed unheard (it was queued behind
// an earlier turn's tail); zero with it clear means there was nothing to hear.
//
// endsTheTurn says the flush is for the turn in progress. A stale interruption
// (see openTurns) is about an older turn whose audio was flushed when it was
// cancelled; it leaves the current turn's isResponding alone, because a turn
// that is still being generated is not over. The event carries no turn
// identity, so staleness is worked out from the order turns start and end.
func (s *Session) stopPlayback(endsTheTurn bool) (playedMs int, hadQueued bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stopPlaybackLocked(endsTheTurn)
}

// 中文注释：在锁内停止当前播放，返回已播放时长和队列状态。
func (s *Session) stopPlaybackLocked(endsTheTurn bool) (playedMs int, hadQueued bool) {

	cleared := s.leg.ClearTx()
	s.framer.reset()

	// What was queued, less what never made it out of the queue. Anything
	// already handed to the wire counts as heard.
	played := max(s.framesQueued-cleared, 0)
	hadQueued = s.framesQueued > 0
	s.framesQueued = 0
	s.isBotSpeaking = false
	s.audibleSince = time.Time{}
	s.audibleUntil = time.Time{}
	s.recordingSpeechDeadline = time.Time{}
	if endsTheTurn {
		s.isResponding = false
	}
	// Nothing is left to drain, and no dead-air timer should run: the caller is
	// already talking.
	s.drainGeneration++
	s.idleGeneration++

	return played * frameDurationMs, hadQueued
}

// endInterruptedTurn accounts for an interruption event and reports whether it
// ended the turn in progress rather than an older, already-replaced one.
func (s *Session) endInterruptedTurn() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.openTurns = max(s.openTurns-1, 0)
	return s.openTurns == 0
}

func (s *Session) beginTurn() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.beginTurnLocked()
}

func (s *Session) beginTurnLocked() {
	s.turnHadQueuedAudio = false
	s.turnHasOutputText = false
	s.framesQueued = 0
	s.turnSeq++
	s.isResponding = true
	s.turnOwedUntil = time.Time{}
	s.openTurns = min(s.openTurns+1, 2)
	if s.isCutOff {
		if s.cutOffChunks > 0 {
			s.log.Debug("dropped the audio of a response that was cut off",
				"chunks", s.cutOffChunks)
		}
		s.isCutOff, s.cutOffChunks = false, 0
	}
	// Any pending drain or dead-air watch belongs to the previous turn.
	s.drainGeneration++
	s.idleGeneration++
	s.recordingSpeechDeadline = time.Time{}
}

// isHoldingTheFloor reports whether the bot has the floor: a turn is being
// generated, or its tail is still playing to the caller. A turn asked for now
// would collide with it — refused on the Realtime providers, cut off
// mid-sentence on gemini.
func (s *Session) isHoldingTheFloor() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.isResponding || s.isBotSpeaking ||
		(!s.turnOwedUntil.IsZero() && time.Now().Before(s.turnOwedUntil)) ||
		(s.framesQueued > 0 && s.leg.Pending() > 0)
}

// queuedPlayout is how long the audio queued for the caller takes to play.
func (s *Session) queuedPlayout() time.Duration {
	return time.Duration(s.leg.Pending()) * frameDurationMs * time.Millisecond
}

// audioProgress reports how many turns have finished generating with audio,
// and whether the turn in progress has queued any so far.
func (s *Session) audioProgress() (finishedTurns int, isCurrentSpeaking bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.audioTurns, s.framesQueued > 0
}

// CurrentTurn reports the latest response, including tool-only responses.
func (s *Session) CurrentTurn() int { return s.currentTurn() }
func (s *Session) HasOutput() bool  { return s.isHoldingTheFloor() }

// QueuedAudioForTurn distinguishes an unvoiced draft from a response that
// may already have reached the caller. Older turns are kept conservatively.
// This is not proof of audible playback.
func (s *Session) QueuedAudioForTurn(turn int) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turnSeq != turn || s.turnHadQueuedAudio
}

// currentTurn reports which model turn is in progress.
func (s *Session) currentTurn() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.turnSeq
}

// endTurn closes out generation and hands the turn to the playback watcher.
func (s *Session) endTurn() {
	s.mu.Lock()
	// The tail of the last sentence is worth padding out rather than losing.
	s.framer.flush(s.queueFrame)
	s.isBotSpeaking = false
	s.isResponding = false
	s.openTurns = max(s.openTurns-1, 0)
	s.drainGeneration++
	hasAudio := s.framesQueued > 0
	if hasAudio {
		s.audioTurns++
	}
	marker := playbackMarker{generation: s.drainGeneration, turn: s.turnSeq, hasAudio: hasAudio, playbackID: s.playbackID, recordingKey: s.recordingKey, trace: s.activeTrace, generatedAt: time.Now()}
	s.log.Info("voice phase", append(s.activeTrace.LogAttrs(), "phase", "media_generation_complete", "stageAt", marker.generatedAt.UTC(), "turn", s.turnSeq,
		"chunks", s.mediaTiming.chunks, "mediaProcessingUs", s.mediaTiming.processingTime.Microseconds(), "resampleAndG711Us", s.mediaTiming.conversionTime.Microseconds())...)
	s.mu.Unlock()

	select {
	case s.playbackDone <- marker:
	default:
		s.log.Warn("playback watcher is behind; a turn boundary was not tracked")
	}
}

// playbackMarker identifies one turn's handoff to the playback watcher.
type playbackMarker struct {
	trace        provider.ResponseTrace
	generatedAt  time.Time
	playbackID   string
	recordingKey string
	generation   uint64
	turn         int
	// hasAudio says the turn queued audio for the caller.
	hasAudio bool
}

//
// Playback and dead air.
//

// 中文注释：观察音频播放进度与排空结果，生成播放完成相关事件。
// watchPlayback follows a turn from the end of generation to the end of
// hearing, and then watches for a caller who says nothing at all.
//
// The two are separate events because the model finishing a sentence and the
// caller having heard it are separated by everything still in the send queue.
// Anything that must not cut the bot off mid-word — a transfer, a goodbye —
// has to wait for the second, not the first.
func (s *Session) watchPlayback() {
	defer s.wg.Done()

	var next playbackMarker
	var hasNext bool

	for {
		marker := next
		if hasNext {
			hasNext = false
		} else {
			select {
			case <-s.done:
				return
			case marker = <-s.playbackDone:
			}
		}

		idleGeneration, drained := s.awaitDrained(marker.generation)
		if !drained {
			continue
		}
		if control, ok := s.model.(recordingController); ok && marker.playbackID != "" {
			s.mu.Lock()
			s.completedRecordingID = marker.playbackID
			s.mu.Unlock()
			control.RecordingPlayed(marker.playbackID)
			s.mu.Lock()
			if s.playbackID == marker.playbackID {
				s.playbackID, s.recordingKey = "", ""
			}
			s.mu.Unlock()
		}
		s.log.Info("voice phase", append(marker.trace.LogAttrs(), "phase", "local_playback_drained", "stageAt", time.Now().UTC(), "turn", marker.turn,
			"hasAudio", marker.hasAudio, "generationToDrainMs", time.Since(marker.generatedAt).Milliseconds())...)
		s.emit(Event{Type: EventTypePlaybackDone, Trace: marker.trace, Turn: marker.turn, HasAudio: marker.hasAudio, RecordingKey: marker.recordingKey})
		if s.afterPlaybackDone != nil {
			s.afterPlaybackDone()
		}
		next, hasNext = s.awaitCallerOrDeadAir(idleGeneration)
	}
}

// 中文注释：等待当前播放代次排空；代次变化时不复用旧结果。
// awaitDrained waits for the send queue to empty, reporting false if the turn
// was superseded — interrupted, or followed by another — while it waited.
//
// It also returns the idle generation the turn's dead-air watch carries,
// read under the same lock that confirms the drain. Speech from that instant
// on cancels the watch: read any later, after PLAYBACK_DONE is published, a
// caller who spoke in between had already moved the counter, the watch took
// the moved value, and dead air was reported over them.
func (s *Session) awaitDrained(generation uint64) (uint64, bool) {
	ticker := time.NewTicker(frameDurationMs * time.Millisecond)
	defer ticker.Stop()

	for {
		if !s.isCurrentDrain(generation) {
			return 0, false
		}
		if s.leg.Pending() == 0 {
			// One more frame interval so the last frame is actually on the
			// wire, not merely off the queue.
			select {
			case <-s.done:
				return 0, false
			case <-ticker.C:
			}
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.idleGeneration, s.drainGeneration == generation
		}
		select {
		case <-s.done:
			return 0, false
		case <-ticker.C:
		}
	}
}

// awaitCallerOrDeadAir reports dead air if the caller stays silent. It returns
// the next turn's marker, if one arrives first, for the caller to handle.
//
// The wait has to watch for that marker as well as for the clock: the bot
// speaking again says there was no dead air to report, and the new turn's
// playback must be followed from the moment it ends, not from whenever a
// timeout nobody is waiting for any more happens to expire. Leaving the marker
// in the channel put seconds of silence in front of every armed transfer.
func (s *Session) awaitCallerOrDeadAir(generation uint64) (playbackMarker, bool) {
	timeout := s.noInputAfter()
	if timeout <= 0 {
		return playbackMarker{}, false
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-s.done:
	case marker := <-s.playbackDone:
		return marker, true
	case <-timer.C:
		// A stale timer recognises itself rather than being stopped, which
		// removes the race between cancelling and firing entirely.
		if !s.isCurrentIdle(generation) {
			return playbackMarker{}, false
		}
		s.log.Info("dead air", "afterMs", timeout.Milliseconds())
		s.emit(Event{Type: EventTypeNoInput})
	}
	return playbackMarker{}, false
}

// cancelDeadAirWatch invalidates any timer waiting on the caller. It touches
// only the idle counter: speech says the caller is there, not that a turn's
// audio stopped being on its way to them.
func (s *Session) cancelDeadAirWatch() {
	s.mu.Lock()
	s.idleGeneration++
	s.mu.Unlock()
}

func (s *Session) isCurrentDrain(generation uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.drainGeneration == generation
}

func (s *Session) isCurrentIdle(generation uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.idleGeneration == generation
}

//
// Keypresses.
//

// pumpDigits turns keypresses into conversation.
//
// A keypress takes the floor immediately — someone pressing a key while the
// bot talks has decided they are done listening — and the digit is put to the
// model as something the caller did, because otherwise it has no way to know
// it happened.
//
// Once the call's ending is armed the closing line is all that is left to say,
// and a keypress cannot change what happens next. It is still recorded and
// reported (the DIGIT event), but it neither cuts the line off nor asks the
// model for a turn: every key interrupted the line and got its own reply, so a
// caller pressing 0 five times heard the goodbye in five fragments and the
// transfer waited for the last full one.
func (s *Session) pumpDigits() {
	defer s.wg.Done()

	digits := s.leg.Digits()
	for {
		select {
		case <-s.done:
			return
		case digit, ok := <-digits:
			if !ok {
				return
			}
			if s.cfg.IsEndingArmed != nil && s.cfg.IsEndingArmed() {
				s.log.Info("a keypress after the ending was armed is only recorded", "digit", digit)
				s.emit(Event{Type: EventTypeDigit, Text: digit})
				continue
			}
			s.bargeIn(provider.InterruptReasonDTMF)
			s.emit(Event{Type: EventTypeDigit, Text: digit})

			if s.cfg.ManualDigits {
				continue
			}
			if err := s.SendCue(keypressText(digit)); err != nil {
				s.log.Warn("could not report a keypress to the model",
					"digit", digit, "error", err)
			}
		}
	}
}

// keypressText is how a keypress is described to the model. It reads as a
// stage direction rather than as speech, so the model does not answer as if
// the caller had said the number out loud.
func keypressText(digit string) string {
	return fmt.Sprintf("(The caller pressed %s on their keypad.)", digit)
}

//
// Lifecycle.
//

// watchLeg ends the model session when the caller hangs up.
func (s *Session) watchLeg() {
	defer s.wg.Done()

	select {
	case <-s.leg.Stopped():
		s.log.Info("caller leg ended, closing the model session")
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		s.Close(ctx)
	case <-s.done:
	}
}

// fail ends the call because the conversation cannot go on.
//
// The cause travels with it when the provider named one: what releases the call
// is the same rescue either way, but "the provider's session ran out of time" is
// a different thing to find in a CDR from "the provider failed".
func (s *Session) fail(reason string, err error, cause provider.FailureCause) {
	s.log.Error("ai call failed", "reason", reason, "error", err, "cause", cause)
	s.emit(Event{Type: EventTypeFailed, Text: reason, Err: err, FailureCause: cause})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	s.Close(ctx)
}

// emit publishes an event, dropping it once the call is over.
func (s *Session) emit(event Event) {
	select {
	case s.events <- event:
	case <-s.done:
	}
}
