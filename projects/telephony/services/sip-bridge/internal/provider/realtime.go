// SPDX-License-Identifier: Apache-2.0
// Taigua adaptation: extracted for the existing workspace-scoped sales system.

// 中文导读：实时模型连接、事件转换与对话请求管理。
package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	syncatomic "sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"taigua/sip-bridge/internal/provider/wsconn"
)

// Watchdogs on a response. A provider that accepts a turn and then goes quiet
// is indistinguishable from a broken call to the person listening.
const (
	// firstAudioTimeout bounds the wait between asking for a response and
	// hearing the first of it.
	firstAudioTimeout = 3 * time.Second
	// deltaStallTimeout bounds a gap in the middle of a response. Audio has
	// already arrived, so the right answer is to finish with what there is.
	deltaStallTimeout = 2 * time.Second
	// The provider's automatic VAD reply can be in flight before its
	// response.created reaches us. Only local fallback requests wait here;
	// normal provider replies never wait for this timer.
	automaticResponseGrace = 500 * time.Millisecond
	// eventBuffer is how far the consumer may fall behind. The consumer is a
	// per-call actor forwarding to a paced send queue, so it should never come
	// close.
	eventBuffer = 256
)

// Realtime is a session against any provider speaking the realtime protocol.
// Vendor differences live entirely in its Profile.
type Realtime struct {
	profile         Profile
	apiKey          string
	log             *slog.Logger
	usageMu         sync.Mutex
	usage           UsageSnapshot
	usageSeen       map[string]struct{}
	isLocallyClosed syncatomic.Bool

	events chan Event
	conn   *wsconn.Conn

	// ready closes when the provider has accepted the session configuration.
	ready     chan struct{}
	readyOnce sync.Once
	// startErr records why the handshake failed, if it did.
	startErr atomic[error]
	// isResponseOpen is true between a response starting and its completion
	// being handled. The watchdog consults it before abandoning anything,
	// because its own progress signals are droppable and the completion is
	// the one that must never be missed.
	isResponseOpen syncatomic.Bool

	closeOnce             sync.Once
	readDone              chan struct{}
	shutdownUpdates       chan struct{}
	shutdownBufferCleared bool
	providerSessionID     string
	providerRequestID     string
	providerResponseID    string
	activeResponseID      string
	recentResponseIDs     []string
	timing                realtimeTiming
	trafficCtx            context.Context
	stopTraffic           context.CancelFunc

	// Wire events already have one reader. The watchdog joins that same
	// per-session sequence so its cancellation cannot land on a newer reply
	// between an old response.done and its replacement response.created.
	responseEventMu     sync.Mutex
	instructionUpdateMu sync.Mutex
	// Guarded by responseEventMu, including the final channel close.
	isEventStreamClosed bool
	mu                  sync.Mutex
	// cfg is fixed at Start. Some providers freeze turn detection after the
	// first audio frame, so nothing here is adjusted mid-call except the
	// instructions.
	cfg          SessionConfig
	instructions string
	// responseItemID identifies the assistant's current audio item, which is
	// what truncation refers to. It belongs to one response: it is cleared when
	// the next response is created and once the item has been truncated, so a
	// trim never lands on an item the caller heard in full earlier.
	responseItemID string
	// The instruction used to elicit the greeting is transient. Keeping a
	// user message saying "repeat this sentence" biases later short turns.
	openingCueID string
	// isSessionRetried guards the one-shot retry of a rejected configuration.
	isSessionRetried bool

	// The three fields a pre-empting spoken line needs. See SpeakText.
	//
	// pendingSpeak is a line waiting for the floor; there is at most one,
	// because a newer line supersedes an older one rather than joining a
	// queue. isResponseRequested covers the window between asking for a turn
	// and the provider creating it, in which there is nothing to cancel and a
	// second request would be refused. isPreemptedForSpeak remembers that the
	// turn now ending was stopped to make room, which is what keeps the
	// interruption from being reported as the caller's.
	pendingSpeak         string
	isPendingSpeakGuided bool
	// A partial customer utterance or intercepted question gives the caller
	// the floor. Provider VAD may still start a response; none of its audio
	// is played until a deliberate reply releases this hold.
	isReplyHeld bool
	// isPendingSpeakClosing is SpeakText's isClosing for pendingSpeak.
	isPendingSpeakClosing bool
	isResponseRequested   bool
	// A local sequence only identifies our own reservation, not a provider
	// response. It prevents an older failed write from releasing a newer one.
	responseRequestSeq          uint64
	responseRequestSource       string
	responseRequestCustomerTurn uint64
	responseRequestEventID      string
	responseRequestText         string
	responseRequestClosing      bool
	responseRequestGuided       bool
	// An active-response refusal may precede the provider's response.created.
	// Its reservation ends on created/done, or a bounded reconciliation wait.
	isResponseConflict   bool
	isCancelSentForSpeak bool
	isPreemptedForSpeak  bool
	// A local watchdog must not release a floor the provider still owns.
	// Epochs also keep old timeout callbacks out of a later caller turn.
	responseEpoch           uint64
	responseLastActivityAt  time.Time
	isResponseStalled       bool
	automaticResponseEpoch  uint64
	isAutomaticReplyPending bool
	manualReplies           bool

	// The fields a request for a turn made while the floor is taken needs. See
	// SendToolResult, SendUserText and releaseOwedTurn.
	//
	// isTurnOwed means something is in the conversation that wants a turn
	// (a tool result, or a cue) and the turn it asks for has not been
	// requested yet, because a response still held the floor when it arrived
	// (W-Q4). It is a flag, not a count: however many results and cues one
	// response produced, they are answered in one turn.
	// isOwedPastCreate marks a turn owed while a request was in flight and
	// nothing was open yet. The response that request makes was asked for
	// before the item, so it is not the turn that was owed and its creation
	// must not discharge it.
	// isCallerSpeaking means the provider has reported the caller starting to
	// speak and neither the end of that speech nor a new response since. Its
	// own turn detection answers that speech with a response of its own.
	isTurnOwed       bool
	isOwedPastCreate bool
	isCallerSpeaking bool

	// callItems are the function calls the response now open has begun and not
	// yet finished, by item id (the call id as the value), and finishedCalls the
	// ones whose arguments did arrive, by both ids. They belong to one response:
	// response.created clears them and response.done settles them. See
	// removeUnfinishedCalls.
	callItems     map[string]string
	finishedCalls map[string]struct{}

	// deleteSentAt is when this client last asked the provider to delete an
	// item, which is what lets a refusal of that be recognised; see
	// isAnsweredDelete.
	deleteSentAt time.Time

	// cancelSentAt is when this client last asked the provider to cancel a
	// response. It is what lets a refusal of that cancel be recognised as
	// the answer to our own request; see isAnsweredCancel.
	cancelSentAt time.Time
	// cancelReason is why that cancel was sent, so the provider's confirmation
	// of it (a response that ends cancelled) names the decision that caused it
	// rather than the default, speech. Spent when a response ends.
	cancelReason InterruptReason
	// Cancellation is reserved once per observed response. A queued request
	// has no cancellable response, and an older actor may not cancel its successor.
	cancelResponseEpoch uint64
	hasResponseCancel   bool
	cancelEventID       string
	cancelHistory       []responseCancellation

	// dog ends a turn the provider has walked away from, and watch is the
	// channel its progress signals travel on.
	dog   *Watchdog
	watch chan WatchSignal
	// Watchdog deadlines, held as fields so tests need not wait seconds for
	// behaviour that is measured in seconds on a real call.
	firstAudioDeadline time.Duration
	deltaStallDeadline time.Duration
}

// The names this client knows the watchdog's signals by.
const (
	watchResponseStarted = WatchResponseStarted
	watchAudioArrived    = WatchAudioArrived
	watchResponseEnded   = WatchResponseEnded
)

// atomic is a tiny typed holder; sync/atomic's generic Pointer would need a
// pointer indirection for an interface value.
type atomic[T any] struct {
	mu sync.Mutex
	v  T
}

func (a *atomic[T]) set(v T) { a.mu.Lock(); a.v = v; a.mu.Unlock() }
func (a *atomic[T]) get() T  { a.mu.Lock(); defer a.mu.Unlock(); return a.v }

// New builds a session for a profile. The credential is read from the
// environment named by the profile, so a missing key fails here rather than
// mid-call.
func New(profile Profile, log *slog.Logger) (*Realtime, error) {
	apiKey := os.Getenv(profile.APIKeyEnv)
	if apiKey == "" {
		return nil, fmt.Errorf("provider %s: %s is not set", profile.Name, profile.APIKeyEnv)
	}
	if log == nil {
		log = slog.Default()
	}
	trafficCtx, stopTraffic := context.WithCancel(context.Background())
	return &Realtime{
		profile:         profile,
		apiKey:          apiKey,
		log:             log.With("provider", profile.Name, "model", profile.Model),
		events:          make(chan Event, eventBuffer),
		ready:           make(chan struct{}),
		readDone:        make(chan struct{}),
		shutdownUpdates: make(chan struct{}, 1),
		trafficCtx:      trafficCtx,
		stopTraffic:     stopTraffic,

		firstAudioDeadline: firstAudioTimeout,
		deltaStallDeadline: deltaStallTimeout,
	}, nil
}

// Profile reports the vendor configuration in use.
func (r *Realtime) Profile() Profile { return r.profile }

func (r *Realtime) Events() <-chan Event { return r.events }

// Start connects, configures the session, and asks for the opening turn.
func (r *Realtime) Start(ctx context.Context, cfg SessionConfig) (startResult error) {
	defer func() {
		if startResult != nil && !errors.Is(startResult, context.Canceled) && !r.isLocallyClosed.Load() {
			r.observeConnection(false)
		}
	}()
	r.mu.Lock()
	r.cfg = cfg
	r.instructions = cfg.Instructions
	r.mu.Unlock()
	setupCtx := ctx
	if !cfg.SetupDeadline.IsZero() {
		var cancel context.CancelFunc
		setupCtx, cancel = context.WithDeadline(ctx, cfg.SetupDeadline)
		defer cancel()
	}

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+r.apiKey)
	for key, value := range r.profile.Headers {
		headers.Set(key, value)
	}

	conn, err := wsconn.Dial(setupCtx, r.profile.endpointURL(), headers, r.log)
	if err != nil {
		r.observeConnection(false)
		return startupFailure("connect", err)
	}
	r.conn = conn
	r.providerRequestID = providerUpgradeRequestID(conn.Header())
	r.log.Info("realtime provider connected", "providerRequestId", r.providerRequestID)
	r.dog = NewWatchdog(WatchdogConfig{
		FirstAudioDeadline: r.firstAudioDeadline,
		DeltaStallDeadline: r.deltaStallDeadline,
		Done:               conn.Done(),
		IsResponseOpen:     r.isResponseOpen.Load,
		OnStall:            r.onResponseStalled,
	})
	r.watch = r.dog.Signals()
	go r.readLoop()
	go r.dog.Run()

	if err := r.sendEvent(r.buildSessionUpdate(cfg, false)); err != nil {
		r.conn.Close()
		return startupFailure("configure", err)
	}

	// The configuration must be accepted before any audio is sent, because on
	// at least one provider the turn-detection settings freeze at the first
	// frame.
	select {
	case <-r.ready:
	case <-setupCtx.Done():
		r.conn.Close()
		return startupFailure("configure", setupCtx.Err())
	case <-time.After(wsconn.DialTimeout):
		r.conn.Close()
		if err := r.startErr.get(); err != nil {
			return startupFailure("configure", err)
		}
		return startupFailure("configure", context.DeadlineExceeded)
	}
	if err := r.startErr.get(); err != nil {
		r.conn.Close()
		return startupFailure("configure", err)
	}

	// The session is ready; the request for the first turn may still be held
	// back (SessionConfig.OpeningGate). The handshake deadline above is over,
	// so a long wait is not a timeout, and nothing is sent meanwhile.
	if err := AwaitOpeningGate(ctx, cfg.OpeningGate, r.conn.Done()); err != nil {
		r.conn.Close()
		return fmt.Errorf("wait to greet: %w", err)
	}

	if cfg.SkipOpening {
		return nil
	}
	// The opening turn is the flow's first node speaking; the caller is
	// already on the line waiting to be greeted.
	//
	// Two shapes, and the flow chooses. Saying nothing about the words leaves
	// the model to write its greeting from the standing instructions, which is
	// what every call did before a phase could carry a line — and the request
	// is the bare one it always was. Naming a line asks for that line instead.
	opening := map[string]any{"type": "response.create"}
	cue := greetingCue(cfg)
	if cfg.OpeningText != "" {
		line := sayExactly(cfg.OpeningText, cfg.Language)
		direction := cfg.Instructions + "\n【本轮只输出指定的一句话，保持上述本人节奏与声线】\n" + line
		opening["response"] = map[string]any{"instructions": direction}
		// The response carries the full policy. Its transient user cue carries
		// only the requested sentence rather than duplicating the whole policy
		// and business context as if the customer had spoken it.
		cue = line
	}
	if r.profile.NeedsCueForFirstTurn {
		item := userTextItem(cue)
		cueID := fmt.Sprintf("tg_open_%x", time.Now().UnixNano())
		item["item"].(map[string]any)["id"] = cueID
		r.mu.Lock()
		r.openingCueID = cueID
		r.mu.Unlock()
		if err := r.sendEvent(item); err != nil {
			r.conn.Close()
			return fmt.Errorf("prompt opening turn: %w", err)
		}
	}
	if err := r.requestResponse(opening, "opening"); err != nil {
		r.conn.Close()
		return fmt.Errorf("request opening turn: %w", err)
	}
	return nil
}

// userTextItem is the frame that puts text in the conversation as a caller
// message: a cue, a keypress, a directed line.
func userTextItem(text string) map[string]any {
	return map[string]any{
		"type": "conversation.item.create",
		"item": map[string]any{
			"type": "message", "role": "user",
			"content": []map[string]any{{"type": "input_text", "text": text}},
		},
	}
}

// greetingCue is the stage direction that gets a provider talking first.
func greetingCue(cfg SessionConfig) string {
	if cfg.GreetingCue != "" {
		return cfg.GreetingCue
	}
	if strings.HasPrefix(strings.ToLower(cfg.Language), "zh") {
		return "（电话已接通，请按照你的指示开始问候来电者。）"
	}
	return "(The call has connected. Greet the caller as instructed.)"
}

// SendAudio forwards one chunk of caller audio.
//
// The JSON is assembled directly around the base64 rather than marshalled from
// a struct: this runs fifty times a second per call in each direction, and
// marshalling would copy every frame twice more for no benefit. Base64's
// alphabet needs no JSON escaping, so this is safe as well as cheap.
func (r *Realtime) SendAudio(audio []byte) error {
	if r.isLocallyClosed.Load() {
		return errSessionClosed
	}
	const prefix = `{"type":"input_audio_buffer.append","audio":"`

	message := make([]byte, 0, len(prefix)+base64.StdEncoding.EncodedLen(len(audio))+2)
	message = append(message, prefix...)
	message = base64.StdEncoding.AppendEncode(message, audio)
	message = append(message, '"', '}')

	return r.conn.SendContext(r.trafficCtx, message)
}

// SendUserText adds a caller turn that was not spoken and asks for a reply.
//
// While a response holds the floor, or one has been asked for and not yet
// created, a second request is refused, and the refusal comes back as an async
// error that nothing retries: the item would sit in the conversation
// unanswered. So the reply is owed and asked for when that response ends,
// exactly as a tool result's is (SendToolResult).
//
// After an interruption of our own the response stays open until the provider
// confirms the cancel, so the reply to a keypress that cancelled a turn waits
// one round trip for it. A request sent straight behind the cancel was
// accepted by qwen, but that is the one provider it was measured on, and the
// cue cannot tell here whether a cancel just went out; the wait is the
// cheaper mistake than a refused cue.
func (r *Realtime) SendUserText(text string) error {
	if err := r.sendEvent(userTextItem(text)); err != nil {
		return err
	}
	// Decided after the item is sent, as SendToolResult does, so a turn
	// released by the read loop is never requested ahead of the item it answers.
	r.mu.Lock()
	isOpen := r.isResponseOpen.Load()
	isOwed := isOpen || r.isResponseRequested || r.isTurnOwed
	if isOwed {
		r.isTurnOwed = true
		if !isOpen && r.isResponseRequested {
			r.isOwedPastCreate = true
		}
	}
	r.mu.Unlock()
	if isOwed {
		r.log.Debug("a response holds the floor; the reply to this cue waits for it to end")
		return nil
	}
	return r.requestResponse(map[string]any{"type": "response.create"}, "user_text")
}

// SpeakText says a line the flow chose, in place of whatever is being said now.
//
// This protocol has no way to hand a provider audio to play, so the nearest
// thing it offers is a turn of its own with a per-response instruction: the
// model is told to repeat one sentence and nothing else. That is best effort
// rather than verbatim, and it is the honest limit of this client — an engine
// that speaks text outright gets its own profile and says the line as written.
// Where the override alone loses to the conversation already there, a line
// that ends the call is put in the conversation too (askForLine).
//
// The floor may already be taken, and asking for a second response while one
// is open is refused with "conversation already has an active response". Two
// states have to be told apart:
//
//   - a response is open: it is cancelled now, and the request for the line
//     goes out when that response's own response.done arrives. The cancel is
//     sent whatever the profile says about barge-in — CancelsResponseItself
//     describes a provider that stops when it hears the CALLER, and nobody
//     here is speaking.
//   - a response has been asked for and not yet created: there is nothing to
//     cancel yet, so the line waits, and the turn is stopped the moment it
//     exists. SendToolResult asks for a turn on its way out, and a phase
//     change is decided on that very result, so this is the ordinary case
//     rather than the exotic one.
//
// When the floor is free it is claimed under the same lock that found it
// free, before anything is written: a second SpeakText arriving while the
// line's frames are still going out finds it taken and waits, rather than
// asking for a second response the provider would refuse.
//
// The read loop owns both deferred sends. Nothing is emitted from here, for
// the reason Interrupt gives: this is normally called from the goroutine
// draining Events, and emitting would deadlock it.
func (r *Realtime) SpeakText(text string, isClosing bool) error {
	return r.requestDirectedReply(text, isClosing, false)
}

// HoldReply does not change the model's history or discard customer audio.
// The call actor flushes playback and sends the current cancellation.
func (r *Realtime) HoldReply() error {
	r.mu.Lock()
	r.holdReplyLocked()
	r.mu.Unlock()
	return nil
}

func (r *Realtime) HoldReplyResponse(trace ResponseTrace) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !trace.SameResponse(r.timing.trace) {
		return false, nil
	}
	r.holdReplyLocked()
	return true, nil
}

func (r *Realtime) holdReplyLocked() {
	r.isReplyHeld = true
	r.pendingSpeak = ""
	r.isPendingSpeakClosing, r.isPendingSpeakGuided = false, false
	r.isTurnOwed = false
	r.responseRequestText = ""
}

// HoldReplyIfIdle reserves the floor for an interruptible local utterance.
// A customer or an already requested model response always takes precedence.
func (r *Realtime) HoldReplyIfIdle() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.isLocallyClosed.Load() || r.isCallerSpeaking || r.isReplyHeld || r.isResponseOpen.Load() || r.isResponseRequested || r.isAutomaticReplyPending || r.isTurnOwed {
		return false
	}
	r.isReplyHeld = true
	return true
}

func (r *Realtime) ReleaseReply() {
	r.mu.Lock()
	r.isReplyHeld = false
	r.mu.Unlock()
}

// GuideReply repairs a turn using the real conversation. The direction is a
// per-response instruction, never a synthetic customer message in history.
func (r *Realtime) GuideReply(hint string) error {
	return r.requestDirectedReply(hint, false, true)
}

func (r *Realtime) GuideReplyResponse(trace ResponseTrace, hint string) (bool, error) {
	return r.requestDirectedReplyFor(&trace, hint, false, true)
}

// EnsureReplyIfIdle fills a genuinely idle floor after a greeting. It never
// cancels an automatic response or replaces a line already being synthesized.
func (r *Realtime) EnsureReplyIfIdle(hint string) (bool, error) {
	if r.isLocallyClosed.Load() {
		return false, errSessionClosed
	}
	r.mu.Lock()
	if r.isCallerSpeaking || r.isReplyHeld || r.isResponseOpen.Load() || r.isResponseRequested || r.isAutomaticReplyPending {
		r.mu.Unlock()
		return false, nil
	}
	requestSeq := r.claimFloorLocked("idle_opening_repair")
	language := r.cfg.Language
	r.mu.Unlock()
	if err := r.askForLine(hint, language, false, true, requestSeq); err != nil {
		return false, err
	}
	return true, nil
}

func (r *Realtime) requestDirectedReply(text string, isClosing, guided bool) error {
	_, err := r.requestDirectedReplyFor(nil, text, isClosing, guided)
	return err
}

func (r *Realtime) requestDirectedReplyFor(expected *ResponseTrace, text string, isClosing, guided bool) (bool, error) {
	if text == "" {
		return false, nil
	}

	r.mu.Lock()
	if expected != nil && (!expected.SameResponse(r.timing.trace) || (expected.CustomerTurn != 0 && expected.CustomerTurn != r.timing.customerSequence)) {
		r.mu.Unlock()
		return false, nil
	}
	r.isReplyHeld = false
	if guided && r.isCallerSpeaking {
		// Their continuation will trigger the provider's normal response.
		// Sending a repair now would compete with speech that is not over.
		r.mu.Unlock()
		return false, nil
	}
	// An owed turn has not necessarily been requested. A directed reply can
	// claim that idle floor and answer the same context instead of waiting for
	// a response that nobody has sent.
	isDeferred := r.isResponseOpen.Load() || r.isResponseRequested || r.isAutomaticReplyPending
	isCancelNeeded := r.isResponseOpen.Load() && !r.isCancelSentForSpeak
	cancelEpoch := r.responseEpoch
	if isCancelNeeded {
		r.isCancelSentForSpeak = true
		r.isPreemptedForSpeak = true
	}
	r.pendingSpeak, r.isPendingSpeakClosing, r.isPendingSpeakGuided = "", false, false
	var requestSeq uint64
	if isDeferred {
		r.pendingSpeak, r.isPendingSpeakClosing, r.isPendingSpeakGuided = text, isClosing, guided
	} else {
		requestSeq = r.claimFloorLocked("directed_reply")
	}
	language := r.cfg.Language
	r.mu.Unlock()

	if isCancelNeeded {
		if err := r.sendCancelForEpoch(InterruptReasonSystem, cancelEpoch); err != nil {
			return false, err
		}
	}
	if isDeferred {
		return true, nil
	}
	return true, r.askForLine(text, language, isClosing, guided, requestSeq)
}

// claimFloorLocked records that a turn is on its way before anything asks for
// it: the state requestResponse sets, set early. The caller holds mu.
func (r *Realtime) claimFloorLocked(source string) uint64 {
	r.responseRequestSeq++
	r.responseRequestText = ""
	r.responseRequestSource = source
	r.responseRequestCustomerTurn = r.timing.customerSequence
	r.isResponseRequested = true
	r.isResponseConflict = false
	r.isTurnOwed = false
	r.isOwedPastCreate = false
	r.timing.requestedAt = time.Now()
	r.responseRequestEventID = fmt.Sprintf("tg_response_%x_%x", r.responseRequestSeq, r.timing.requestedAt.UnixNano())
	return r.responseRequestSeq
}

// The caller holds mu from reservation validation through this write.
func (r *Realtime) writeResponseRequestLocked(request map[string]any) error {
	out := make(map[string]any, len(request)+1)
	for key, value := range request {
		out[key] = value
	}
	out["event_id"] = r.responseRequestEventID
	started := time.Now()
	err := r.sendEvent(out)
	trace := ResponseTrace{CustomerTurn: r.responseRequestCustomerTurn, ProviderSessionID: r.providerSessionID, ProviderRequestID: r.providerRequestID}
	r.log.Info("voice phase", append(trace.LogAttrs(), "phase", "response_request_written", "stageAt", time.Now().UTC(),
		"localRequest", r.responseRequestSeq, "clientEventId", r.responseRequestEventID, "source", r.responseRequestSource,
		"writeMs", time.Since(started).Milliseconds(), "sent", err == nil)...)
	return err
}

// askForLine asks for the turn that says one line, on a floor the caller has
// already claimed (claimFloorLocked): the request carrying the direction as a
// per-response override and, for a line that ends the call on a profile that
// needs it (NeedsDirectedLineInConversation), the same direction put in the
// conversation as a caller message first. The item goes strictly before the
// request, so the turn the request makes is made with it in view.
//
// Only a closing line is put in the conversation. The item stays in the
// history, and what a caller message saying "repeat this sentence" does to the
// turns after it has not been measured — a call that is ending has no turns
// after it to spoil. A line in a phase the conversation goes on from keeps
// the override alone, for the reason answerToolCall keeps such a line out of
// a tool result.
//
// Both of SpeakText's ways to the floor end here — asked at once, or asked when
// the turn that held it has ended — so a line is steered the same way whichever
// one it took. If nothing could be asked for, the claim is released so that
// the next line is not left waiting for a turn that will never come.
func (r *Realtime) askForLine(text, language string, isClosing, guided bool, requestSeq uint64) error {
	// response.instructions replaces session instructions. Keep the selected
	// person's delivery reference and tuning on fixed lines as well as replies.
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.responseRequestSeq != requestSeq || !r.isResponseRequested || r.isResponseOpen.Load() || r.isReplyHeld || (guided && (r.isCallerSpeaking || r.isAutomaticReplyPending || r.responseRequestCustomerTurn != r.timing.customerSequence)) {
		if r.responseRequestSeq == requestSeq && !r.isResponseOpen.Load() {
			r.isResponseRequested, r.isResponseConflict = false, false
		}
		return nil
	}
	base := r.instructions
	// Keep the payload until response.created accepts it. A successful socket
	// write can still be refused asynchronously by a busy provider.
	r.responseRequestText, r.responseRequestClosing, r.responseRequestGuided = text, isClosing, guided
	direction := base + "\n【本轮只输出指定的一句话，保持上述本人节奏与声线】\n" + sayExactly(text, language)
	if guided {
		direction = base + "\n【本轮回应要求】\n" + text
	}
	err := func() error {
		if r.profile.NeedsDirectedLineInConversation && (isClosing || r.profile.Name == "stepfun") {
			// The response carries the full policy. Do not duplicate business
			// instructions and customer data inside the transient speaking cue.
			cue := sayExactly(text, language)
			if guided {
				cue = text
			}
			item := userTextItem(cue)
			cueID := fmt.Sprintf("tg_line_%x", time.Now().UnixNano())
			item["item"].(map[string]any)["id"] = cueID
			r.openingCueID = cueID
			if err := r.sendEvent(item); err != nil {
				return err
			}
		}
		return r.writeResponseRequestLocked(speakRequest(direction))
	}()
	if err != nil {
		r.isResponseRequested, r.isResponseConflict = false, false
	}
	return err
}

// speakRequest is the frame that asks for one line, said as written;
// direction is SayExactly's demand for it.
//
// One frame for both dialects: the type discriminator the GA session object
// carries has no counterpart on a response, and both name the per-response
// override the same way, so there is nothing here for a dialect to disagree
// about.
func speakRequest(direction string) map[string]any {
	return map[string]any{
		"type":     "response.create",
		"response": map[string]any{"instructions": direction},
	}
}

// SayExactly is how a model is asked for particular words rather than for a
// subject. In the session's own language, because an instruction in the wrong
// one is an invitation to answer in it.
//
// It is exported because a phase's announce is words the flow chose and nobody
// should paraphrase, and a client that can only direct a model has to ask for
// them the same way: the same demand, in the same language, ahead of the same
// text. A client whose engine speaks text outright needs none of it.
func SayExactly(text, language string) string {
	if strings.HasPrefix(strings.ToLower(language), "zh") {
		return "保持所选音色的自然声线，把话说给电话对面正在交流的人听。亲切、温和、有感情，语调有可听见的起伏和轻重音对比。称呼后略停，按意群连贯说话，在逗号轻停、句末稍停，关键时间、数量和操作说明稍放慢；问句柔和询问，语气在整句中自然变化，不只抬高最后一个字。避免逐字等速、播报腔、夸张热情和假笑。停顿与情绪只通过声音体现，不念出说明。" + lineDelivery(text) + "请一字不差地说出下面这句话，不要添加任何其它内容：\n" + text
	}
	return "Keep the selected voice identity. Speak warmly and expressively as in a natural phone conversation, with light phrase pauses, meaningful emphasis, and subtle changes in pace and intonation. Avoid a flat or announcer-like reading. Convey emotion through the audio without adding spoken directions. Say exactly this, word for word, and add nothing else:\n" + text
}

func lineDelivery(text string) string {
	for _, word := range []string{"理解", "不打扰", "先忙", "没关系", "不方便", "抱歉"} {
		if strings.Contains(text, word) {
			return "本句是在体谅对方：起音温暖柔和，前半先接纳，后半像商量一样留余地。保持连贯和有温度的声音，不能只靠压低音高和拖慢来表示耐心。"
		}
	}
	for _, word := range []string{"可以呀", "好呀", "好的", "太好", "没问题", "整理", "接下来"} {
		if strings.Contains(text, word) {
			return "本句是在爽快回应：开头轻快肯定，主体保持积极、愿意帮忙的语气，关键动作有清楚重音，结尾落稳。让积极贯穿全句，不要只在第一个语气词上扬后转回平读。"
		}
	}
	if strings.ContainsAny(text, "？?") {
		return "本句是交流式询问：有真实的关心与探询感，问题重点轻轻提起，选项有自然对比，结尾柔和上扬并干净收住。语调变化贯穿问句，不只抬高最后一个字。"
	}
	return "本句是在自然说明：信息连贯，重点清楚，语气温和有回应感，句尾自然落稳。"
}

// sayExactly is the name this client's call sites know it by.
var sayExactly = SayExactly

// requestResponse asks the model for a turn and records that one is on its way.
// Between here and response.created there is nothing to cancel, which is what
// SpeakText has to know before it asks for anything.
//
// Check and reserve under the same lock. A turn that took the floor after the
// caller's earlier check covers the item already sent; the caller records any
// genuinely later cue in isTurnOwed before coming here. Coalescing must not add
// a second owed turn merely because an automatic VAD response won that race.
func (r *Realtime) requestResponse(request map[string]any, source string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.isResponseOpen.Load() {
		return nil
	}
	if r.isResponseRequested {
		return nil
	}
	if r.isReplyHeld || (r.isCallerSpeaking && source != "user_text") || r.isAutomaticReplyPending {
		// The already-committed caller audio owns the next automatic reply.
		// Its creation discharges this fallback too; if it never starts the
		// per-call grace timer releases the owed turn instead.
		r.isTurnOwed = true
		return nil
	}
	r.claimFloorLocked(source)
	if err := r.writeResponseRequestLocked(request); err != nil {
		r.isResponseRequested, r.isResponseConflict = false, false
		return err
	}
	return nil
}

// onResponseCreated stops a turn that was superseded before it existed.
//
// A line asked for while the previous request was still in flight could not be
// cancelled then, because the provider had created nothing. This is the first
// moment there is something to stop.
func (r *Realtime) onResponseCreated(responseID string) {
	r.mu.Lock()
	r.responseEpoch++
	r.activeResponseID = responseID
	if responseID != "" {
		r.providerResponseID = responseID
		r.recentResponseIDs = append(r.recentResponseIDs, responseID)
		if len(r.recentResponseIDs) > 16 {
			r.recentResponseIDs = r.recentResponseIDs[len(r.recentResponseIDs)-16:]
		}
	}
	r.responseItemID = ""
	r.callItems, r.finishedCalls = nil, nil
	r.isResponseOpen.Store(true)
	r.hasResponseCancel = false
	r.cancelReason = ""
	r.isCancelSentForSpeak = false
	r.timing.trace = ResponseTrace{CustomerTurn: r.timing.customerSequence, ResponseEpoch: r.responseEpoch, ResponseID: r.activeResponseID,
		ProviderSessionID: r.providerSessionID, ProviderRequestID: r.providerRequestID}
	r.timing.responseCustomer = r.timing.latest
	r.timing.createdAt = time.Now()
	r.timing.firstTextSeen = false
	attrs := r.timing.trace.LogAttrs()
	attrs = append(attrs, "phase", "response_created_observed", "stageAt", r.timing.createdAt.UTC())
	if r.isResponseRequested {
		// The provider does not echo which create produced this event. An
		// automatic VAD reply can win while our reservation is still pending.
		attrs = append(attrs, "requestSource", r.responseRequestSource, "pendingLocalRequest", r.responseRequestSeq, "pendingClientEventId", r.responseRequestEventID,
			"requestAssociation", "pending_local_request_unconfirmed", "localReservationToCreatedMs", observedInterval(r.timing.requestedAt, r.timing.createdAt))
	} else {
		attrs = append(attrs, "requestSource", "provider_automatic")
	}
	r.responseLastActivityAt = time.Now()
	r.isResponseStalled = false
	r.isAutomaticReplyPending = false
	r.automaticResponseEpoch++
	r.isResponseRequested = false
	r.isResponseConflict = false
	r.responseRequestText = ""
	// Whoever asked for this response — this client or the provider's own
	// turn detection answering the caller — it is made with the tool output
	// in view, so it is the turn that output was owed.
	wasTurnOwed := r.isTurnOwed && !r.isOwedPastCreate
	if wasTurnOwed {
		r.isTurnOwed = false
	}
	r.isOwedPastCreate = false
	isCancelNeeded := (r.pendingSpeak != "" || r.isReplyHeld) && !r.isCancelSentForSpeak
	if isCancelNeeded {
		r.isCancelSentForSpeak = true
		r.isPreemptedForSpeak = true
	}
	cancelEpoch := r.responseEpoch
	r.mu.Unlock()
	r.log.Info("voice phase", attrs...)

	if wasTurnOwed {
		r.log.Debug("a new response answers the tool result that was waiting for the floor")
	}
	if isCancelNeeded {
		if err := r.sendCancelForEpoch(InterruptReasonSystem, cancelEpoch); err != nil {
			r.log.Warn("could not stop the turn a spoken line replaces", "error", err)
		}
	}
}

// dispatchPendingSpeak asks for the line that was waiting, now that the turn
// holding the floor has ended. It reports whether that turn was stopped to make
// room, which is what decides who the interruption is attributed to.
func (r *Realtime) dispatchPendingSpeak() (wasPreempted bool) {
	r.mu.Lock()
	// A caller-side request can claim the newly idle floor before this read
	// loop gets here. Keep the line queued rather than creating beside it.
	if r.isResponseOpen.Load() || r.isResponseRequested || r.isAutomaticReplyPending {
		r.mu.Unlock()
		return false
	}
	wasPreempted = r.isPreemptedForSpeak
	r.isPreemptedForSpeak = false
	r.isCancelSentForSpeak = false
	text, isClosing := r.pendingSpeak, r.isPendingSpeakClosing
	guided := r.isPendingSpeakGuided
	if guided && r.isCallerSpeaking {
		text = ""
	}
	language := r.cfg.Language
	r.pendingSpeak, r.isPendingSpeakClosing, r.isPendingSpeakGuided = "", false, false
	var requestSeq uint64
	if text != "" {
		requestSeq = r.claimFloorLocked("pending_directed_reply")
	}
	r.mu.Unlock()

	if text == "" {
		return wasPreempted
	}
	if err := r.askForLine(text, language, isClosing, guided, requestSeq); err != nil {
		r.log.Warn("could not ask for the line that was waiting for the floor", "error", err)
	}
	return wasPreempted
}

// SendToolResult answers a tool call and steers what happens next.
//
// The hint travels inside the result rather than as a separate instruction
// update: the model reads it as part of what it just learned, which is what
// makes it act on it immediately instead of at some later turn.
//
// The result goes into the conversation at once; the turn it asks for may
// not. A model can go on talking in the same response after calling a tool,
// and asking for a response while one is open is refused ("Cannot create
// response while another response is in progress", qwen-findings W-Q4) —
// OpenAI refuses it too. The turn the result was meant to produce is then
// never made. So while a response is open, or a tool turn is already owed,
// the request is owed instead of sent, and releaseOwedTurn asks for it once
// that response is done. Several results in one response owe one turn.
//
// A batch answered after its response has ended is the same case in another
// shape: the first result asks for the turn, and until the provider reports
// response.created nothing is open, so the next result would ask again and be
// refused (qwen-findings W-Q6). A turn already asked for and not yet started
// covers the results that follow it, so one batch of results asks for exactly
// one response.
func (r *Realtime) AcknowledgeTool(toolCallID, output string) error {
	return r.sendEvent(map[string]any{
		"type": "conversation.item.create",
		"item": map[string]any{
			"type":    "function_call_output",
			"call_id": toolCallID,
			"output":  output,
		},
	})
}

func (r *Realtime) SendToolResult(toolCallID, output, hint string) error {
	if err := r.AcknowledgeTool(toolCallID, mergeHint(output, hint)); err != nil {
		return err
	}

	// Decided after the output is sent, so a turn released by the read loop
	// can never be requested ahead of the output it is meant to answer. If
	// the response ends in between, the floor is seen free here and the turn
	// is asked for now.
	r.mu.Lock()
	if r.isReplyHeld {
		r.mu.Unlock()
		return nil
	}
	isOwed := r.isResponseOpen.Load() || r.isTurnOwed
	if isOwed {
		r.isTurnOwed = true
	}
	isCovered := !isOwed && r.isResponseRequested
	r.mu.Unlock()
	if isCovered {
		r.log.Debug("a turn is already asked for; this tool result rides on it",
			"toolCallId", toolCallID)
		return nil
	}
	if isOwed {
		r.log.Debug("a response holds the floor; the turn for this tool result waits for it to end",
			"toolCallId", toolCallID)
		return nil
	}
	return r.requestResponse(map[string]any{"type": "response.create"}, "tool_result")
}

// releaseOwedTurn asks for the turn a tool result is owed, now that the
// response that held the floor has ended. The read loop calls it after
// dispatchPendingSpeak, so a line that was waiting has already taken the
// floor and — through requestResponse — discharged the tool turn: the line
// is said with the result in view, and one turn is all the floor holds.
//
// The rule for a caller who is speaking: if the provider has reported the
// caller starting to speak, and neither the end of it nor a new response
// since, the turn is held rather than requested. That is the ordinary shape
// of a barge-in — the cancelled response's done arrives one round trip after
// the speech began, long before the turn detector's silence hold ends it.
// The provider's own turn detection answers that speech with a response of
// its own (this client never turns that off), the output is already in the
// conversation for it to read, and a request of ours would land on top of it
// and be refused — or, where it wins the race, answer the tool while the
// caller is still talking. The provider's response.created
// discharges the held turn (onResponseCreated), as does any request this
// client makes in the meantime: a keypress's SendUserText, a SpeakText, the
// dead-air prompt. What is given up is the case where the provider hears
// speech and then answers nothing; the dead-air prompt is what covers a
// silent line, and it asks for a turn that reads the output too.
//
// Once the speech has ended the turn is no longer held. The provider's reply
// normally follows within a round trip, and a request of ours in that gap
// can be refused; but a provider that heard speech while a response was
// still open may never answer it (echo of the bot's own audio is the usual
// source), and a refused request costs a WARN where a stranded turn costs the
// call its next line. The narrower hold is the cheaper mistake.
func (r *Realtime) releaseOwedTurn() {
	r.mu.Lock()
	if !r.isTurnOwed || r.isReplyHeld {
		r.mu.Unlock()
		return
	}
	if r.isCallerSpeaking || r.isAutomaticReplyPending {
		r.mu.Unlock()
		r.log.Debug("the caller is speaking; the owed turn is left to the provider's reply")
		return
	}
	r.mu.Unlock()

	r.log.Debug("the floor is free; asking for the owed turn (a tool result or a cue was waiting)")
	if err := r.requestResponse(map[string]any{"type": "response.create"}, "owed_turn"); err != nil {
		r.log.Warn("could not ask for the owed turn", "error", err)
	}
}

// MergeHint folds steering into a tool result. A result that is already a JSON
// object gains a field; anything else is wrapped so the shape stays predictable.
//
// It is exported because the hint belongs to the flow engine rather than to any
// wire protocol: whatever a client wraps a tool result in, the model has to read
// the steering as part of what it just learned, and in the same shape.
func MergeHint(output, hint string) string {
	if hint == "" {
		return output
	}
	var asObject map[string]json.RawMessage
	if err := json.Unmarshal([]byte(output), &asObject); err == nil && asObject != nil {
		hintJSON, _ := json.Marshal(hint)
		asObject["hint"] = hintJSON
		if merged, err := json.Marshal(asObject); err == nil {
			return string(merged)
		}
	}
	merged, err := json.Marshal(map[string]string{"result": output, "hint": hint})
	if err != nil {
		return output
	}
	return string(merged)
}

// mergeHint is the name this client's one call site knows it by.
var mergeHint = MergeHint

// UpdateInstructions replaces the standing instructions.
//
// Only the instructions are sent. Re-sending the whole configuration would
// re-assert turn detection, which at least one provider treats as an error
// once audio has started flowing.
func (r *Realtime) UpdateInstructions(text string) error {
	r.instructionUpdateMu.Lock()
	defer r.instructionUpdateMu.Unlock()
	r.mu.Lock()
	if r.instructions == text {
		r.mu.Unlock()
		return nil
	}

	session := map[string]any{"instructions": text}
	if r.profile.Style == styleGA {
		session["type"] = "realtime"
	}
	started := time.Now()
	if err := r.sendEvent(map[string]any{"type": "session.update", "session": session}); err != nil {
		r.mu.Unlock()
		return err
	}
	r.instructions = text
	trace := r.timing.trace
	r.mu.Unlock()
	r.log.Info("conversation instructions updated", append(trace.LogAttrs(), "characters", len([]rune(text)), "writeMs", time.Since(started).Milliseconds())...)
	return nil
}

// Interrupt stops the model talking over the caller.
//
// Which side is responsible differs by vendor: one cancels on its own as soon
// as it hears speech and only needs to be told how much was actually heard;
// the other does nothing until asked. That self-cancel is a reaction to the
// provider hearing the caller, so it covers speech and nothing else: a
// keypress or an application decision is something the provider never heard,
// and every profile has to be asked to cancel for it.
//
// The two halves answer different questions and are gated separately. A
// response is cancelled only while one is open — asking a provider to cancel
// a response that already ended is an error on the vendors that accept the
// cancel at all. Truncation has no such limit: the caller goes on hearing an
// utterance for seconds after the provider finished making it, so the amount
// actually heard is worth reporting long after there is anything to stop.
//
// No event is emitted here. The caller already knows it interrupted, and
// emitting from this method would deadlock whenever it is called — as it
// normally is — from the goroutine draining Events. The interruption surfaces
// where the provider confirms it, as a cancelled response.
func (r *Realtime) Interrupt(reason InterruptReason, playedMs int) error {
	return r.InterruptResponse(ResponseTrace{}, reason, playedMs)
}

// InterruptResponse binds playback feedback to the response the actor heard.
// It must not cancel or truncate a response created since that observation.
func (r *Realtime) InterruptResponse(trace ResponseTrace, reason InterruptReason, playedMs int) error {
	r.mu.Lock()
	if !trace.SameResponse(r.timing.trace) {
		r.mu.Unlock()
		r.log.Info("ignored stale response interruption", trace.LogAttrs()...)
		return nil
	}
	itemID := r.responseItemID
	epoch := r.responseEpoch
	r.mu.Unlock()

	isHeardByProvider := reason == InterruptReasonSpeech && r.profile.CancelsResponseItself
	if !isHeardByProvider && r.isResponseOpen.Load() {
		if err := r.sendCancelForEpoch(reason, epoch); err != nil {
			return err
		}
	}

	// Telling the provider how much was heard keeps its conversation history
	// honest: without it the model believes the caller heard a sentence that
	// was cut off after three words.
	//
	// Zero is a report like any other: the turn's audio was queued behind an
	// earlier turn's tail and flushed before a frame reached the caller, so the
	// whole item comes out of the history. The id is spent once truncated, so a
	// second report for the same turn cannot overwrite the first.
	if itemID != "" && playedMs >= 0 {
		r.mu.Lock()
		if r.responseItemID != itemID || r.responseEpoch != epoch {
			r.mu.Unlock()
			return nil
		}
		r.responseItemID = ""
		// Enqueue while holding the state lock: a new response cannot replace
		// the item between the ownership check and this write.
		err := r.sendEvent(map[string]any{
			"type": "conversation.item.truncate", "item_id": itemID,
			"content_index": 0, "audio_end_ms": playedMs,
		})
		r.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

// sendCancel asks the provider to stop the response in progress, and remembers
// when it did.
//
// Whether a response is in progress is only ever this side's belief: the
// provider may finish it in the round trip before the cancel arrives, and then
// it refuses the cancel. No local state closes that window, so the refusal is
// expected and has to be recognisable as ours — see isAnsweredCancel.
func (r *Realtime) sendCancel(reason InterruptReason) error {
	return r.sendCancelForEpoch(reason, 0)
}

func (r *Realtime) sendCancelForEpoch(reason InterruptReason, expected uint64) error {
	if r.isLocallyClosed.Load() {
		return errSessionClosed
	}
	return r.sendCancelContext(r.trafficCtx, reason, expected)
}

// The detached shutdown worker uses its own bounded context after trafficCtx
// is cancelled. It shares the same per-response cancellation reservation.
func (r *Realtime) sendCancelContext(ctx context.Context, reason InterruptReason, expected uint64) error {
	r.mu.Lock()
	if !r.isResponseOpen.Load() || (expected != 0 && r.responseEpoch != expected) || (r.hasResponseCancel && r.cancelResponseEpoch == r.responseEpoch) {
		r.mu.Unlock()
		return nil
	}
	r.cancelSentAt = time.Now()
	r.cancelReason = reason
	r.cancelResponseEpoch, r.hasResponseCancel = r.responseEpoch, true
	r.cancelEventID = fmt.Sprintf("tg_cancel_%x_%x", r.responseEpoch, r.cancelSentAt.UnixNano())
	trace := r.timing.trace
	eventID := r.cancelEventID
	// SendContext only waits for the local writer. Holding mu prevents a
	// response.done/created transition from moving this cancel to a successor.
	data, err := json.Marshal(map[string]any{"type": "response.cancel", "event_id": eventID})
	if err == nil {
		err = r.conn.SendContext(ctx, data)
	}
	if err != nil {
		r.hasResponseCancel = false
	} else {
		r.cancelHistory = append(r.cancelHistory, responseCancellation{eventID: eventID, epoch: r.responseEpoch, sentAt: r.cancelSentAt})
		if len(r.cancelHistory) > 16 {
			r.cancelHistory = r.cancelHistory[len(r.cancelHistory)-16:]
		}
	}
	r.mu.Unlock()
	r.log.Info("voice phase", append(trace.LogAttrs(), "phase", "response_cancel_requested", "stageAt", time.Now().UTC(), "reason", reason, "clientEventId", eventID, "sent", err == nil)...)
	return err
}

// cancelAnswerWindow is how long after a cancel a refusal of it is still taken
// as its answer. A refusal arrives one round trip later (74 ms measured on
// qwen); the window is generous so a slow link does not turn it into a WARN,
// and bounded so the same words long after any cancel still surface.
const cancelAnswerWindow = 5 * time.Second

// isAnsweredCancel reports whether an error is the provider refusing a cancel
// this client sent because the response had already ended — the benign losing
// side of the race sendCancel describes, not a fault.
//
// Matched narrowly, on the code and the words qwen was seen to use
// ("invalid_value: Conversation has no active response"), and only within
// cancelAnswerWindow of a cancel we sent. The error event names neither the
// frame it refuses nor the response it is about, so a time bound is the one
// correlation available; ordering-based bookkeeping would be wrong whenever a
// new response is requested before the refusal arrives, which is exactly what
// a keypress or a spoken line does right after an interruption.
func (r *Realtime) isAnsweredCancel(err *wireError) bool {
	_, ok := r.answeredCancelEpoch(err)
	return ok
}

func (r *Realtime) answeredCancelEpoch(err *wireError) (uint64, bool) {
	if !isCancelRefusal(err) {
		return 0, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for i := len(r.cancelHistory) - 1; i >= 0; i-- {
		attempt := r.cancelHistory[i]
		if time.Since(attempt.sentAt) > cancelAnswerWindow {
			continue
		}
		if err.EventID == "" || err.EventID == attempt.eventID {
			return attempt.epoch, true
		}
	}
	// Retain compatibility with sessions created before event-id tracking.
	if len(r.cancelHistory) == 0 && err.EventID == "" && !r.cancelSentAt.IsZero() && time.Since(r.cancelSentAt) <= cancelAnswerWindow {
		return r.cancelResponseEpoch, true
	}
	return 0, false
}

func isCancelRefusal(err *wireError) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Message)
	return (err.Code == "invalid_value" || err.Code == "response_cancel_not_active") &&
		(strings.Contains(message, "no active response") || strings.Contains(message, "cannot cancel response before response.created"))
}

// Close releases the telephone actor immediately. The only remaining work is
// a detached, bounded protocol shutdown; no old audio or new replies escape it.
func (r *Realtime) Close(_ context.Context) error {
	r.closeOnce.Do(func() {
		r.isLocallyClosed.Store(true)
		r.stopTraffic()
		r.mu.Lock()
		r.pendingSpeak = ""
		r.isPendingSpeakClosing, r.isPendingSpeakGuided = false, false
		r.isTurnOwed, r.isOwedPastCreate = false, false
		r.isReplyHeld = true
		r.mu.Unlock()
		if r.conn != nil {
			go r.finishConnection()
		}
	})
	return nil
}

func (r *Realtime) finishConnection() {
	ctx, cancel := context.WithTimeout(context.Background(), 900*time.Millisecond)
	defer cancel()
	started := time.Now()
	outcome := "settled"
	defer func() {
		r.conn.CloseGracefully(ctx)
		r.mu.Lock()
		sessionID, responseID := r.providerSessionID, r.providerResponseID
		r.mu.Unlock()
		r.log.Info("realtime session shutdown", "reason", "local_session_close", "outcome", outcome,
			"providerSessionId", sessionID, "providerResponseId", responseID,
			"durationMs", time.Since(started).Milliseconds())
	}()
	// The Qwen Omni protocol uses response.cancel and a normal WebSocket close,
	// not the session.finish event of its separate ASR/TTS protocols.
	if r.profile.Name != "qwen" {
		return
	}
	send := func(payload any) error {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		return r.conn.SendContext(ctx, data)
	}
	if err := send(map[string]any{"type": "input_audio_buffer.clear"}); err != nil {
		outcome = "clear_not_sent"
		return
	}
	for {
		r.mu.Lock()
		active, requested, cleared := r.isResponseOpen.Load(), r.isResponseRequested, r.shutdownBufferCleared
		epoch := r.responseEpoch
		r.mu.Unlock()
		if active {
			if err := r.sendCancelContext(ctx, InterruptReasonSystem, epoch); err != nil {
				outcome = "cancel_not_sent"
				return
			}
		}
		if cleared && !active && !requested {
			return
		}
		select {
		case <-r.shutdownUpdates:
		case <-r.readDone:
			outcome = "peer_closed"
			return
		case <-ctx.Done():
			outcome = "cleanup_deadline"
			return
		}
	}
}

// The reader keeps receiving terminal events after the call actor has gone.
// It must never dispatch an owed reply, emit audio, or block on that actor.
func (r *Realtime) handleShutdownEvent(event *wireEvent) {
	r.mu.Lock()
	switch event.Type {
	case "input_audio_buffer.cleared":
		r.shutdownBufferCleared = true
	case "response.created":
		r.responseEpoch++
		r.activeResponseID = event.ResponseID
		if event.Response != nil {
			r.activeResponseID = event.Response.ID
		}
		r.hasResponseCancel, r.cancelReason = false, ""
		r.isResponseOpen.Store(true)
		r.isResponseRequested = false
	case "response.done":
		r.isResponseOpen.Store(false)
		r.isResponseRequested = false
	}
	r.mu.Unlock()
	if event.Type == "response.done" {
		r.observeUsage(event.Response)
	}
	if event.Type == "error" && event.Error != nil {
		if epoch, ok := r.answeredCancelEpoch(event.Error); ok {
			r.mu.Lock()
			if epoch == r.responseEpoch && !r.isResponseRequested {
				r.isResponseOpen.Store(false)
			}
			r.mu.Unlock()
		} else {
			r.log.Info("provider event during shutdown", "code", event.Error.Code,
				"providerEventId", event.EventID)
		}
	}
	select {
	case r.shutdownUpdates <- struct{}{}:
	default:
	}
}

//
// Session payloads.
//

// buildSessionUpdate assembles the configuration in this profile's dialect.
// isReduced drops the optional fields, for the one retry after a rejection.
func (r *Realtime) buildSessionUpdate(cfg SessionConfig, isReduced bool) map[string]any {
	session := map[string]any{"instructions": cfg.Instructions}

	if tools := r.buildTools(cfg.Tools); len(tools) > 0 {
		session["tools"] = tools
	}
	voice := cfg.Voice
	if voice == "" {
		voice = r.profile.Voice
	}

	if r.profile.Style == styleGA {
		inputName, inputRate := r.profile.formatName(cfg.InputFormat)
		outputName, outputRate := r.profile.formatName(cfg.OutputFormat)

		input := map[string]any{
			"format":         audioFormatPayload(inputName, inputRate),
			"turn_detection": r.replyTurnDetection(cfg, isReduced),
		}
		if r.profile.TranscribeModel != "" && !isReduced {
			input["transcription"] = map[string]any{"model": r.profile.TranscribeModel}
		}
		output := map[string]any{"format": audioFormatPayload(outputName, outputRate)}
		if voice != "" {
			output["voice"] = voice
		}

		session["type"] = "realtime"
		session["audio"] = map[string]any{"input": input, "output": output}
		return map[string]any{"type": "session.update", "session": session}
	}

	inputName, _ := r.profile.formatName(cfg.InputFormat)
	outputName, _ := r.profile.formatName(cfg.OutputFormat)
	session["modalities"] = []string{"text", "audio"}
	session["input_audio_format"] = inputName
	session["output_audio_format"] = outputName
	session["turn_detection"] = r.replyTurnDetection(cfg, isReduced)
	if strings.HasPrefix(r.profile.Model, "qwen3.5-omni-") || strings.HasPrefix(r.profile.Model, "qwen3.8-omni-") {
		delete(session, "input_audio_format")
		delete(session, "output_audio_format")
		session["audio"] = map[string]any{"input": map[string]any{"format": map[string]any{"type": "pcm", "sample_rate": 16000}}, "output": map[string]any{"format": map[string]any{"type": "pcm", "sample_rate": 24000}}}
		session["input_audio_transcription"] = map[string]any{"model": "qwen3-asr-flash-realtime"}
	}
	if voice != "" {
		if strings.HasPrefix(r.profile.Model, "qwen3.8-omni-") {
			session["audio"].(map[string]any)["output"].(map[string]any)["voice"] = voice
		} else {
			session["voice"] = voice
		}
	}
	// Only the opening session.update carries it; mid-call updates are
	// instructions alone. It is optional, so the reduced retry drops it: a
	// session at the provider's default beats a caller with no bot.
	if r.profile.AcceptsTemperature && cfg.Temperature != nil && !isReduced {
		session["temperature"] = *cfg.Temperature
	}
	return map[string]any{"type": "session.update", "session": session}
}

func audioFormatPayload(name string, rateHz int) map[string]any {
	format := map[string]any{"type": name}
	if rateHz > 0 {
		format["rate"] = rateHz
	}
	return format
}

func (r *Realtime) replyTurnDetection(cfg SessionConfig, reduced bool) any {
	detection := r.buildTurnDetection(cfg.Turn)
	if cfg.ManualReplies && !reduced {
		if value, ok := detection.(map[string]any); ok {
			value["create_response"] = false
		}
	}
	return detection
}

// buildTurnDetection maps the declarative setting onto the vendor's names.
func (r *Realtime) buildTurnDetection(turn TurnDetection) any {
	switch turn.Mode {
	case TurnModeSemantic:
		detection := map[string]any{"type": r.profile.SemanticTurnType}
		// Where the vendor forces its own hold, sending a different one would
		// only make the configuration lie about what the call will do.
		if r.profile.SemanticTurnSilenceMs == 0 && turn.SilenceMs > 0 {
			detection["silence_duration_ms"] = turn.SilenceMs
		}
		if r.profile.SemanticTurnType == "semantic_vad" && r.profile.Name == "qwen" && turn.Threshold > 0 {
			detection["threshold"] = turn.Threshold
		}
		return detection
	default:
		detection := map[string]any{"type": "server_vad"}
		if turn.SilenceMs > 0 {
			detection["silence_duration_ms"] = turn.SilenceMs
		}
		if turn.Threshold > 0 && r.profile.Name != "stepfun" {
			detection["threshold"] = turn.Threshold
		}
		return detection
	}
}

// isSpokenItem reports whether an output item is the model talking, which is
// the only kind truncation refers to. A dialect that omits the type is taken at
// its word rather than losing the only item there is; a named non-message item
// — a function call — is not a truncation target.
func isSpokenItem(itemType string) bool {
	return itemType == "" || itemType == "message"
}

// buildTools renders tool specifications in the flat shape both providers were
// verified to accept.
func (r *Realtime) buildTools(tools []ToolSpec) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		parameters := json.RawMessage(`{"type":"object","properties":{}}`)
		if len(tool.Parameters) > 0 {
			parameters = tool.Parameters
		}
		function := map[string]any{"name": tool.Name, "description": tool.Description, "parameters": parameters}
		if r.profile.Name == "stepfun" {
			out = append(out, map[string]any{"type": "function", "function": function})
		} else {
			function["type"] = "function"
			out = append(out, function)
		}
	}
	return out
}

//
// Inbound events.
//

func (r *Realtime) readLoop() {
	defer func() {
		// Closing the transport first releases a watchdog blocked on a write
		// or an event send. Stream closure then joins its event sequence: a
		// timer that already passed Done cannot send to a closed channel.
		r.conn.Close()
		r.responseEventMu.Lock()
		r.isEventStreamClosed = true
		close(r.events)
		close(r.readDone)
		r.responseEventMu.Unlock()
	}()

	for {
		event, raw, err := r.receive()
		if err != nil {
			// There is no reconnect: the provider holds conversation state
			// that cannot be rebuilt, so a lost socket ends the session and
			// the call is routed somewhere a person can take it.
			r.finishStart(err)
			if !isNormalClosure(err) && !r.isLocallyClosed.Load() {
				if !r.isLocallyClosed.Load() {
					r.observeConnection(false)
				}
				r.emit(Event{
					Type: EventTypeError, Err: err, IsFatal: true,
					Text: "provider connection lost",
				})
			}
			r.emit(Event{Type: EventTypeClosed})
			return
		}
		if event == nil {
			r.log.Debug("ignored non-text frame", "bytes", len(raw))
			continue
		}
		r.responseEventMu.Lock()
		r.handle(event)
		r.responseEventMu.Unlock()
	}
}

func (r *Realtime) handle(event *wireEvent) {
	if event.Session != nil && event.Session.ID != "" {
		r.mu.Lock()
		r.providerSessionID = event.Session.ID
		r.mu.Unlock()
		if event.Type == "session.created" {
			r.log.Info("realtime session created", "providerSessionId", event.Session.ID, "providerEventId", event.EventID)
		}
	}
	responseID := event.ResponseID
	if event.Response != nil && event.Response.ID != "" {
		responseID = event.Response.ID
	}
	if responseID != "" {
		r.mu.Lock()
		stale := event.Type != "response.created" && r.activeResponseID != "" && responseID != r.activeResponseID
		duplicate := false
		if event.Type == "response.created" {
			duplicate = responseID == r.activeResponseID
			for _, seen := range r.recentResponseIDs {
				duplicate = duplicate || seen == responseID
			}
		}
		if !stale && !duplicate {
			r.providerResponseID = responseID
		}
		r.mu.Unlock()
		if stale || duplicate {
			if event.Type == "response.done" {
				r.observeUsage(event.Response)
			}
			r.log.Info("ignored stale provider response event", "type", event.Type, "providerResponseId", responseID, "duplicate", duplicate)
			return
		}
	}
	if r.isLocallyClosed.Load() {
		r.handleShutdownEvent(event)
		return
	}
	switch event.Type {
	case "session.created":
		// Informational: the provider's defaults, before ours are applied.
		return

	case "session.updated":
		if event.Session != nil && event.Session.TurnDetection != nil {
			detection := event.Session.TurnDetection
			r.mu.Lock()
			create, acknowledged := detection["create_response"].(bool)
			r.manualReplies = r.cfg.ManualReplies && acknowledged && !create
			manual := r.manualReplies
			r.mu.Unlock()
			r.log.Info("direct recording response control", "requested", r.cfg.ManualReplies, "enabled", manual, "createResponse", detection["create_response"])
			r.log.Info("realtime turn detection acknowledged", "type", detection["type"],
				"silenceMs", detection["silence_duration_ms"], "threshold", detection["threshold"])
		}
		r.observeConnection(true)
		r.finishStart(nil)
		r.emit(Event{Type: EventTypeSessionReady})

	case "input_audio_buffer.speech_started":
		trace := r.observeSpeech(event, true)
		r.mu.Lock()
		r.isCallerSpeaking = true
		r.isAutomaticReplyPending = false
		r.automaticResponseEpoch++
		// A new continuation supersedes guidance queued for the previous
		// utterance. A deliberate closing line keeps its existing semantics.
		if r.isPendingSpeakGuided {
			r.pendingSpeak = ""
			r.isPendingSpeakGuided, r.isPendingSpeakClosing = false, false
		}
		r.mu.Unlock()
		r.emit(Event{Type: EventTypeSpeechStarted, Trace: trace})

	case "input_audio_buffer.speech_stopped":
		trace := r.observeSpeech(event, false)
		r.mu.Lock()
		r.isCallerSpeaking = false
		r.isAutomaticReplyPending = !r.manualReplies
		r.automaticResponseEpoch++
		epoch := r.automaticResponseEpoch
		r.mu.Unlock()
		time.AfterFunc(automaticResponseGrace, func() { r.releaseAutomaticReplyWait(epoch) })
		r.emit(Event{Type: EventTypeSpeechStopped, Trace: trace})

	case "response.created":
		r.onResponseCreated(responseID)
		r.signal(watchResponseStarted)
		r.emit(Event{Type: EventTypeResponseStarted})

	case "response.output_item.added":
		// Only the item carrying speech can be truncated. A turn that says
		// something before it calls a tool adds a second item, and letting
		// that one overwrite the id would aim the truncate at the function
		// call: the provider rejects it, and the model is left believing the
		// caller heard a sentence that was cut off three words in.
		if event.Item != nil && event.Item.ID != "" && isSpokenItem(event.Item.Type) {
			r.mu.Lock()
			r.responseItemID = event.Item.ID
			r.mu.Unlock()
		}
		// A function call is open until its arguments are done; see
		// removeUnfinishedCalls.
		if event.Item != nil && event.Item.ID != "" && event.Item.Type == "function_call" {
			r.mu.Lock()
			if r.callItems == nil {
				r.callItems = make(map[string]string)
			}
			r.callItems[event.Item.ID] = event.Item.CallID
			r.mu.Unlock()
		}

	// Both the current and the older names for model audio.
	case "response.audio.delta", "response.output_audio.delta":
		r.mu.Lock()
		held := r.isReplyHeld || r.isPreemptedForSpeak || r.isResponseStalled
		if !r.isResponseStalled {
			r.responseLastActivityAt = time.Now()
		}
		r.mu.Unlock()
		if held {
			return
		}
		audio, err := base64.StdEncoding.AppendDecode(nil, []byte(event.Delta))
		if err != nil {
			r.emit(Event{Type: EventTypeError, Err: fmt.Errorf("undecodable audio: %w", err)})
			return
		}
		r.signal(watchAudioArrived)
		r.emit(Event{Type: EventTypeAudioDelta, Audio: audio})

	case "response.audio_transcript.delta", "response.output_audio_transcript.delta":
		r.mu.Lock()
		held := r.isReplyHeld || r.isPreemptedForSpeak || r.isResponseStalled
		r.mu.Unlock()
		if held {
			return
		}
		r.observeFirstText(event.Delta)
		r.emit(Event{Type: EventTypeOutputTranscript, Text: event.Delta})

	case "response.audio_transcript.done", "response.output_audio_transcript.done":
		r.mu.Lock()
		held := r.isReplyHeld || r.isPreemptedForSpeak || r.isResponseStalled
		r.mu.Unlock()
		if held {
			return
		}
		r.observeFirstText(event.Transcript)
		r.emit(Event{Type: EventTypeOutputTranscript, Text: event.Transcript, IsFinal: true})

	case "conversation.item.input_audio_transcription.delta":
		r.emit(Event{Type: EventTypeInputTranscript, Text: event.Delta})

	case "conversation.item.input_audio_transcription.completed":
		r.emit(Event{Type: EventTypeInputTranscript, Trace: r.observeTranscript(event), Text: event.Transcript, IsFinal: true})

	case "conversation.item.input_audio_transcription.failed":
		r.log.Warn("customer transcription failed")
		r.emit(Event{Type: EventTypeInputTranscript, Trace: r.observeTranscript(event), IsFinal: true})

	case "response.function_call_arguments.done":
		r.finishCall(event.ItemID, event.CallID)
		arguments := event.Arguments
		if arguments == "" {
			arguments = "{}"
		}
		r.emit(Event{
			Type: EventTypeToolCall, ToolCallID: event.CallID,
			ToolName: event.Name, ToolArgs: arguments,
		})

	case "conversation.item.deleted":
		r.log.Debug("the provider removed an item from the conversation", "itemId", event.ItemID)

	case "response.done":
		r.handleResponseDone(event)

	case "error":
		r.handleError(event)

	default:
		r.log.Debug("unmapped provider event", "type", event.Type)
	}
}

func (r *Realtime) handleResponseDone(event *wireEvent) {
	r.observeUsage(event.Response)
	r.removeOpeningCue()
	r.mu.Lock()
	attrs := r.timing.trace.LogAttrs()
	attrs = append(attrs, "phase", "model_response_done_observed", "stageAt", time.Now().UTC(),
		"responseCreatedToDoneMs", observedInterval(r.timing.createdAt, time.Now()))
	if r.hasResponseCancel && r.cancelResponseEpoch == r.responseEpoch {
		attrs = append(attrs, "cancelToDoneMs", observedInterval(r.cancelSentAt, time.Now()))
	}
	r.isResponseOpen.Store(false)
	wasStalled := r.isResponseStalled
	r.isResponseStalled = false
	wasPreemptedForSpeak := r.isPreemptedForSpeak
	r.isPreemptedForSpeak, r.isCancelSentForSpeak = false, false
	if r.isResponseConflict {
		r.isResponseRequested = false
		r.isResponseConflict = false
	}
	r.mu.Unlock()
	r.log.Info("voice phase", attrs...)
	cancelledFor := r.takeCancelReason()
	r.signal(watchResponseEnded)
	// Before anything asks for a turn, so that turn is made from a
	// conversation without the calls this one left unfinished.
	r.removeUnfinishedCalls(event.Response)
	// The floor is free: a line that was waiting for it goes out before the
	// turn is reported, so the next words are already being made while the
	// consumer catches up.
	isPreemptedForSpeak := r.dispatchPendingSpeak() || wasPreemptedForSpeak
	// Then the turn a tool result answered mid-response is owed, unless the
	// line just asked for is that turn.
	r.releaseOwedTurn()
	if wasStalled {
		// The watchdog already ended local playback. This terminal event
		// only acknowledges cancellation and releases the provider's floor.
		return
	}

	out := Event{Type: EventTypeResponseDone}
	if event.Response != nil {
		out.Status = event.Response.Status
		if usage := event.Response.Usage; usage != nil {
			out.Usage = Usage{
				InputTokens:  usage.InputTokens,
				OutputTokens: usage.OutputTokens,
				TotalTokens:  usage.TotalTokens,
			}
		}
	}
	// A cancelled response is a turn that was cut short, whether we asked for
	// it or the provider decided on its own when it heard the caller. Either
	// way the consumer needs to know the turn ended early rather than
	// completing, so it is reported as an interruption in its own right.
	//
	// Who cut it short is the one thing that differs, and it has to be said:
	// the consumer flushes what it has queued either way — the caller must not
	// go on hearing an abandoned answer, and how much of it they did hear is
	// counted on that side and trimmed from the provider's history — but a
	// turn this client stopped to make room for a line is not a barge-in, and
	// logging it as one puts an interruption the caller never made into the
	// record of the call.
	if out.Status == statusCancelled {
		by := InterruptReasonSpeech
		if cancelledFor != "" {
			by = cancelledFor
		}
		if isPreemptedForSpeak {
			by = InterruptReasonSystem
		}
		r.emit(Event{
			Type: EventTypeInterrupted, Status: out.Status,
			Usage: out.Usage, InterruptedBy: by,
		})
		return
	}
	r.emit(out)
}

// Keep the bot's greeting and the caller's words in context, but discard the
// one-time instruction that requested the greeting before any later turn.
func (r *Realtime) removeOpeningCue() {
	r.mu.Lock()
	id := r.openingCueID
	r.openingCueID = ""
	if id != "" {
		r.deleteSentAt = time.Now()
	}
	r.mu.Unlock()
	if id != "" {
		if err := r.sendEvent(map[string]any{"type": "conversation.item.delete", "item_id": id}); err != nil {
			r.log.Debug("could not remove opening cue", "error", err)
		}
	}
}

// takeCancelReason returns why this client last cancelled, if it did so within
// cancelAnswerWindow, and forgets it: one cancel explains one response's end.
// A response that ended on its own after a cancel lost the race spends the
// reason too, so it cannot label a later cancel the provider decides itself.
func (r *Realtime) takeCancelReason() InterruptReason {
	r.mu.Lock()
	defer r.mu.Unlock()
	reason := r.cancelReason
	r.cancelReason = ""
	if time.Since(r.cancelSentAt) > cancelAnswerWindow {
		return ""
	}
	return reason
}

// statusCancelled is what both providers call a response that was cut short.
const statusCancelled = "cancelled"

// statusCompleted is a response that ran to its end.
const statusCompleted = "completed"

// finishCall records that a function call's arguments arrived, so it is a call
// the consumer has been handed and will answer, never one to take back. The
// event names the item and the call; either may be missing in a dialect, so
// both are kept.
func (r *Realtime) finishCall(itemID, callID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.finishedCalls == nil {
		r.finishedCalls = make(map[string]struct{})
	}
	for id, call := range r.callItems {
		if (itemID != "" && id == itemID) || (callID != "" && call == callID) {
			delete(r.callItems, id)
		}
	}
	if itemID != "" {
		r.finishedCalls[itemID] = struct{}{}
	}
	if callID != "" {
		r.finishedCalls[callID] = struct{}{}
	}
}

// removeUnfinishedCalls takes out of the conversation every function call a
// response that did not complete left half made.
//
// A response cut off while it is writing a call's arguments (a keypress, a
// barge-in, a preempting line) leaves the call item in the conversation, with
// whatever arguments had arrived, and the provider never sends the event that
// finishes it. qwen's model then reads its own unanswered call as the thing it
// has already done: asked again, it often says "transferring you" and never
// calls the tool, and keeps copying that (qwen-findings W-Q5). Deleting the item
// puts the next turn back on a history without it.
//
// Which calls: those begun in this response (output_item.added) or listed in
// its output, minus any whose arguments completed. A completed call was handed
// to the consumer as a tool call and will get its output, so it stays. Which
// responses: any that did not complete, because cancelled, incomplete and
// failed all stop mid-item and all leave the same remnant. A completed response
// is left alone. The stall path does not come here: the provider has not said
// that response is over and may still finish the call, and deleting an item
// that then gets its arguments and its output would break a call the consumer
// is answering.
//
// A refused delete is not a fault (an item already gone, or a provider without
// the event); see isAnsweredDelete.
func (r *Realtime) removeUnfinishedCalls(response *wireResponse) {
	r.mu.Lock()
	open, finished := r.callItems, r.finishedCalls
	r.callItems, r.finishedCalls = nil, nil
	r.mu.Unlock()

	if response == nil || response.Status == "" || response.Status == statusCompleted {
		return
	}
	ids := make(map[string]struct{}, len(open))
	for id := range open {
		ids[id] = struct{}{}
	}
	for _, item := range response.Output {
		if item.Type != "function_call" || item.ID == "" {
			continue
		}
		_, isItemFinished := finished[item.ID]
		_, isCallFinished := finished[item.CallID]
		if !isItemFinished && !(item.CallID != "" && isCallFinished) {
			ids[item.ID] = struct{}{}
		}
	}
	for id := range ids {
		r.mu.Lock()
		r.deleteSentAt = time.Now()
		r.mu.Unlock()
		if err := r.sendEvent(map[string]any{
			"type":    "conversation.item.delete",
			"item_id": id,
		}); err != nil {
			r.log.Debug("could not take an unfinished function call out of the conversation",
				"itemId", id, "error", err)
			continue
		}
		r.log.Debug("took the function call a cancelled response left unfinished out of the conversation",
			"itemId", id, "status", response.Status)
	}
}

// isAnsweredDelete reports whether an error is the provider refusing an item
// delete this client sent: the item was already gone, or the dialect does not
// have the event. Either way the history is as clean as it can be made, so it
// is not reported.
//
// Matched like isAnsweredCancel: within cancelAnswerWindow of a delete we sent,
// and on words that name a missing item or an unsupported event, because the
// error names neither the frame it refuses nor the item.
func (r *Realtime) isAnsweredDelete(err *wireError) bool {
	r.mu.Lock()
	sentAt := r.deleteSentAt
	r.mu.Unlock()
	if sentAt.IsZero() || time.Since(sentAt) > cancelAnswerWindow {
		return false
	}
	message := strings.ToLower(err.Message)
	if err.Code == "item_not_found" || err.Param == "item_id" {
		return true
	}
	for _, words := range []string{"not found", "does not exist", "no such item", "unknown event", "unsupported", "not supported", "conversation.item.delete"} {
		if strings.Contains(message, words) {
			return true
		}
	}
	return false
}

func (r *Realtime) handleError(event *wireEvent) {
	if event.Error == nil {
		r.emit(Event{Type: EventTypeError, Err: errors.New("provider reported an unspecified error")})
		return
	}
	err := event.Error

	// A rejected configuration takes the whole session with it — persona,
	// tools and all — so it is worth one retry without the optional parts
	// before giving up on the call.
	if err.Param == "session.update" && r.canRetrySession() {
		r.log.Warn("session configuration rejected, retrying without optional fields",
			"code", err.Code, "message", err.Message)
		r.mu.Lock()
		cfg := r.cfg
		r.mu.Unlock()
		if sendErr := r.sendEvent(r.buildSessionUpdate(cfg, true)); sendErr == nil {
			return
		}
	}

	// A cancel that lost the race with the response ending changes nothing:
	// the turn is over either way, and its response.done has already said
	// so. It is not reported, so the WARN count of a healthy call means
	// something.
	if r.isAnsweredCancel(err) {
		r.log.Info("provider cancellation raced with response lifecycle",
			"code", err.Code, "message", err.Message, "clientEventId", err.EventID)
		return
	}
	if isCancelRefusal(err) {
		// A late or uncorrelated cancel refusal is not a rejected create.
		// Surface it without releasing a successor's reservation.
		r.emit(Event{Type: EventTypeError, Err: err, Text: err.Message})
		return
	}

	if r.isAnsweredDelete(err) {
		r.log.Debug("the provider refused to delete an item",
			"code", err.Code, "message", err.Message)
		return
	}

	// A request for a turn that the provider refused for any reason but a
	// response already running will never be created, so it must not go on
	// covering the tool results that follow it (SendToolResult).
	if isActiveResponseError(err) {
		r.mu.Lock()
		requestSeq, source := r.responseRequestSeq, r.responseRequestSource
		isOpen, isRequested := r.isResponseOpen.Load(), r.isResponseRequested
		matchesRequest := err.EventID == "" || err.EventID == r.responseRequestEventID
		waitForResponse := matchesRequest && isRequested && !isOpen && !r.isResponseConflict
		if waitForResponse {
			r.isResponseConflict = true
			if r.pendingSpeak == "" && r.responseRequestText != "" && !r.isReplyHeld && (!r.responseRequestGuided || (!r.isCallerSpeaking && r.responseRequestCustomerTurn == r.timing.customerSequence)) {
				r.pendingSpeak = r.responseRequestText
				r.isPendingSpeakClosing, r.isPendingSpeakGuided = r.responseRequestClosing, r.responseRequestGuided
			}
		}
		r.mu.Unlock()
		r.log.Info("provider response conflict", "code", err.Code, "param", err.Param,
			"lastLocalSource", source, "localRequest", requestSeq, "isOpen", isOpen, "isRequested", isRequested)
		if waitForResponse {
			time.AfterFunc(firstAudioTimeout, func() { r.releaseUnreconciledConflict(requestSeq) })
		}
	} else {
		r.mu.Lock()
		if !r.isResponseOpen.Load() && (err.EventID == "" || err.EventID == r.responseRequestEventID) {
			r.isResponseRequested = false
			r.isResponseConflict = false
		}
		r.mu.Unlock()
	}

	r.finishStart(err)
	if r.startErr.get() != nil {
		r.observeConnection(false)
	}
	r.emit(Event{Type: EventTypeError, Err: err, Text: err.Message})
}

// Match both forms observed from the realtime service. This is a busy floor,
// not permission to send another response while its creation is in flight.
func isActiveResponseError(err *wireError) bool {
	message := strings.ToLower(err.Message)
	return strings.Contains(message, "another response is in progress") ||
		strings.Contains(message, "conversation already has an active response")
}

// A busy refusal does not prove the provider floor is idle. Retain the
// directed payload for its eventual created/done acknowledgement; when none
// arrives, report a failed session instead of silently losing the line or
// issuing another conflicting response.create.
func (r *Realtime) releaseUnreconciledConflict(requestSeq uint64) {
	r.responseEventMu.Lock()
	defer r.responseEventMu.Unlock()
	if r.isLocallyClosed.Load() || r.isEventStreamClosed {
		return
	}
	select {
	case <-r.conn.Done():
		return
	default:
	}
	r.mu.Lock()
	if r.responseRequestSeq != requestSeq || !r.isResponseConflict || !r.isResponseRequested || r.isResponseOpen.Load() || r.isReplyHeld {
		r.mu.Unlock()
		return
	}
	r.mu.Unlock()
	r.log.Warn("provider response conflict was not reconciled", "localRequest", requestSeq)
	r.emit(Event{Type: EventTypeError, IsFatal: true, Text: "provider response conflict did not acknowledge its active response",
		Err: errors.New("provider response conflict reconciliation timed out")})
}

// canRetrySession allows exactly one reduced retry, before the session is up.
func (r *Realtime) canRetrySession() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	select {
	case <-r.ready:
		return false
	default:
	}
	if r.isSessionRetried {
		return false
	}
	r.isSessionRetried = true
	return true
}

// finishStart releases Start, recording the first failure if there was one.
func (r *Realtime) finishStart(err error) {
	r.readyOnce.Do(func() {
		if err != nil {
			r.startErr.set(err)
		}
		close(r.ready)
	})
}

// StatusStalled is the status on a response the provider abandoned partway.
// It is synthesised here, not reported by any provider.
const StatusStalled = "STALLED"

// onResponseStalled closes out a turn the provider walked away from. The
// watchdog calls it on its own goroutine, having already decided that a
// response really is open.
func (r *Realtime) onResponseStalled(hasAudioArrived bool) {
	r.responseEventMu.Lock()
	defer r.responseEventMu.Unlock()
	if r.isLocallyClosed.Load() || r.isEventStreamClosed {
		return
	}
	reason := "the provider never started speaking"
	if hasAudioArrived {
		reason = "the provider stopped partway through speaking"
	}
	r.mu.Lock()
	if !r.isResponseOpen.Load() || r.isResponseStalled {
		r.mu.Unlock()
		return
	}
	deadline := r.firstAudioDeadline
	if hasAudioArrived {
		deadline = r.deltaStallDeadline
	}
	// A late watchdog tick may belong to a response that just ended or to
	// audio whose progress signal is still queued. Never cancel that newer
	// activity merely because the old timer won a scheduler race.
	if !r.responseLastActivityAt.IsZero() && time.Since(r.responseLastActivityAt) < deadline {
		r.mu.Unlock()
		return
	}
	r.isResponseStalled = true
	r.isPreemptedForSpeak, r.isCancelSentForSpeak = true, true
	epoch := r.responseEpoch
	r.mu.Unlock()
	r.signal(watchResponseEnded)
	r.log.Warn("response abandoned", "reason", reason,
		"hasAudioArrived", hasAudioArrived)
	// Stop local speech immediately, but keep the provider's response open
	// until it confirms the cancellation. Clearing it locally and sending a
	// replacement here creates a second response beside the still-live one.
	r.emit(Event{Type: EventTypeInterrupted, Status: StatusStalled, InterruptedBy: InterruptReasonSystem})
	if err := r.sendCancel(InterruptReasonSystem); err != nil {
		r.emit(Event{Type: EventTypeError, IsFatal: true, Text: "could not cancel stalled provider response", Err: err})
		return
	}
	r.emit(Event{Type: EventTypeError, Text: reason,
		Err: errors.New(reason)})
	time.AfterFunc(firstAudioTimeout, func() { r.expireStalledResponse(epoch) })
}

// releaseAutomaticReplyWait is a fallback for a provider that accepts caller
// audio but never creates its automatic response. It cannot release a newer
// utterance or a response that has already started.
func (r *Realtime) releaseAutomaticReplyWait(epoch uint64) {
	if r.isLocallyClosed.Load() {
		return
	}
	select {
	case <-r.conn.Done():
		return
	default:
	}
	r.mu.Lock()
	if !r.isAutomaticReplyPending || r.automaticResponseEpoch != epoch || r.isCallerSpeaking {
		r.mu.Unlock()
		return
	}
	r.isAutomaticReplyPending = false
	r.mu.Unlock()
	r.dispatchPendingSpeak()
	r.releaseOwedTurn()
}

// An unacknowledged cancellation cannot safely be retried as a new response.
// End only this failed session instead of manufacturing a free provider floor.
func (r *Realtime) expireStalledResponse(epoch uint64) {
	r.responseEventMu.Lock()
	defer r.responseEventMu.Unlock()
	if r.isLocallyClosed.Load() || r.isEventStreamClosed {
		return
	}
	select {
	case <-r.conn.Done():
		return
	default:
	}
	r.mu.Lock()
	unacknowledged := r.responseEpoch == epoch && r.isResponseStalled && r.isResponseOpen.Load()
	r.mu.Unlock()
	if !unacknowledged {
		return
	}
	r.log.Warn("stalled response cancellation was not acknowledged", "responseEpoch", epoch)
	r.emit(Event{Type: EventTypeError, IsFatal: true, Text: "stalled provider response did not acknowledge cancellation",
		Err: errors.New("stalled provider response cancellation timed out")})
}

// signal notifies the watchdog without ever blocking the read loop.
func (r *Realtime) signal(s WatchSignal) { r.dog.Signal(s) }

// emit delivers an event, dropping it only once the session is finished.
func (r *Realtime) emit(event Event) {
	if r.isLocallyClosed.Load() {
		return
	}
	if event.Type != EventTypeInputTranscript && event.Type != EventTypeSpeechStarted && event.Type != EventTypeSpeechStopped && event.Trace.ResponseEpoch == 0 {
		r.mu.Lock()
		event.Trace = r.timing.trace
		r.mu.Unlock()
	}
	select {
	case r.events <- event:
	case <-r.trafficCtx.Done():
	case <-r.conn.Done():
		// The session is over; nobody is reading any more.
	}
}

func isNormalClosure(err error) bool {
	return errors.Is(err, net.ErrClosed) ||
		websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway)
}
