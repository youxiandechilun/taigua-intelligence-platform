// SPDX-License-Identifier: Apache-2.0
// SIP voice components are adapted from rasonyang/ai-native-callcenter.
// Existing QuickVoice remains the sole identity, queue and customer authority.
// 中文导读：SIP 语音桥入口：接收应用派发，协调 FreeSWITCH、实时模型、录音播放及事件回传。
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"taigua/sip-bridge/internal/aicall"
	"taigua/sip-bridge/internal/esl"
	"taigua/sip-bridge/internal/media"
	"taigua/sip-bridge/internal/provider"
	"taigua/sip-bridge/internal/voice"
	"time"
)

type line struct {
	ServerIP       string   `json:"serverIp"`
	Port           int      `json:"port"`
	Transport      string   `json:"transport"`
	Caller         string   `json:"callerNumber"`
	CallerMode     string   `json:"callerMode"`
	Prefix         string   `json:"prefix"`
	EmployeePrefix string   `json:"employeePrefix"`
	Codecs         []string `json:"codecs"`
}
type request struct {
	SystemSpeech             *systemSpeech                     `json:"systemSpeech,omitempty"`
	OpeningInterruptionRules *openingInterruptionRules         `json:"openingInterruptionRules,omitempty"`
	AssistantDetectionRules  []assistantDetectionRule          `json:"assistantDetectionRules"`
	IntentRules              []intentRule                      `json:"intentRules,omitempty"`
	TestCall                 bool                              `json:"testCall,omitempty"`
	Recordings               []provider.Recording              `json:"recordings,omitempty"`
	Audio                    *media.AudioSettings              `json:"audio,omitempty"`
	Flow                     *flowGraph                        `json:"flow,omitempty"`
	CredentialScope          string                            `json:"credentialScope"`
	Mode                     string                            `json:"mode"`
	EmployeePhone            string                            `json:"employeePhone"`
	CustomerID               string                            `json:"customerCallId,omitempty"`
	ID                       string                            `json:"attemptId"`
	WorkspaceID              string                            `json:"workspaceId,omitempty"`
	Phone                    string                            `json:"phoneNumber"`
	Line                     line                              `json:"line"`
	Instructions             string                            `json:"instructions"`
	Opening                  string                            `json:"opening"`
	Voice                    string                            `json:"voice"`
	RealtimeModel            string                            `json:"realtimeModel"`
	SpeechSynthesis          *provider.SpeechSynthesisSettings `json:"speechSynthesis,omitempty"`
	Language                 string                            `json:"language"`
	DemoCall                 bool                              `json:"demoCall,omitempty"`
	Duration                 int                               `json:"maxDurationSeconds"`
	RingTimeout              int                               `json:"ringTimeoutSeconds,omitempty"`
	Record                   bool                              `json:"record"`
}
type flowTrace struct {
	NodeID string `json:"nodeId"`
	Title  string `json:"title"`
	Branch string `json:"branch"`
	At     string `json:"at"`
}
type transcript struct {
	Speaker   string `json:"speaker"`
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"`
}
type switchDiagnostics struct {
	Leg            string `json:"leg"`
	Cause          string `json:"cause,omitempty"`
	SIPStatus      int    `json:"sipStatus,omitempty"`
	SIPDisposition string `json:"sipDisposition,omitempty"`
}
type event struct {
	AnsweringMachineDetected bool                     `json:"answeringMachineDetected,omitempty"`
	AssistantDetection       *assistantDetectionMatch `json:"assistantDetection,omitempty"`
	Intent                   string                   `json:"intent,omitempty"`
	IntentEvidence           string                   `json:"intentEvidence,omitempty"`
	MatchedRules             []intentRuleMatch        `json:"matchedRules,omitempty"`
	FlowTrace                []flowTrace              `json:"flowTrace,omitempty"`
	Collected                map[string]string        `json:"collected,omitempty"`
	FlowOutcome              string                   `json:"flowOutcome,omitempty"`
	ID                       string                   `json:"eventId"`
	AttemptID                string                   `json:"attemptId"`
	State                    string                   `json:"state"`
	At                       string                   `json:"occurredAt"`
	Duration                 int                      `json:"durationSeconds"`
	Reason                   string                   `json:"reason"`
	Recording                string                   `json:"recordingFile,omitempty"`
	Transcript               []transcript             `json:"transcript"`
	OptOut                   bool                     `json:"optOutRequested"`
	Handoff                  bool                     `json:"handoffRequested"`
	Diagnostics              *switchDiagnostics       `json:"diagnostics,omitempty"`
	ModelUsage               *provider.UsageSnapshot  `json:"modelUsage,omitempty"`
}
type liveTranscriptEvent struct {
	AttemptID     string `json:"attemptId"`
	MessageID     string `json:"messageId"`
	Speaker       string `json:"speaker"`
	Scope         string `json:"scope,omitempty"`
	Text          string `json:"text"`
	Timestamp     string `json:"timestamp"`
	PreviousAgent string `json:"previousAgent,omitempty"`
}
type call struct {
	AssistantDetection *assistantDetectionMatch
	Intent             string
	IntentEvidence     string
	MatchedRules       []intentRuleMatch
	FlowTrace          []flowTrace
	Collected          map[string]string
	FlowOutcome        string
	Req                request
	Synthesis          *provider.SpeechSynthesis
	mu                 sync.Mutex
	Transcript         []transcript
	OptOut             bool
	Handoff            bool
	EndReason          string
	Failed             bool
	Finished           bool
	Started            time.Time
	CustomerID         string
	OriginateJobID     string
	reservationOnce    sync.Once
	Dialog             *voice.Dialog
	Model              *provider.Realtime
	Session            *aicall.Session
}
type app struct {
	token         string
	stateDir      string
	recordDir     string
	callback      string
	link          *esl.Link
	profile       provider.Profile
	uas           *voice.UAS
	calls         sync.Map
	dispatchMu    sync.Mutex
	live          bool
	max           int
	pending       atomic.Int64
	operationsMu  sync.Mutex
	recentQuality []storedCallQuality
}

var safePrefix = regexp.MustCompile(`^[0-9A-Za-z_-]{0,30}$`)
var phone = regexp.MustCompile(`^(1[3-9][0-9]{9}|0[0-9]{9,11})$`)
var caller = regexp.MustCompile(`^[0-9A-Za-z_-]{1,30}$`)

var modelEnvironmentMu sync.Mutex
var scopedEnvironment = regexp.MustCompile(`^TG_[A-F0-9]{64}_(DASHSCOPE|DEEPSEEK|ZHIPU|STEPFUN)_API_KEY$`)
var modelScope = regexp.MustCompile(`^[A-F0-9]{64}$`)
var modelSecret = regexp.MustCompile(`^[A-Za-z0-9_.-]{16,512}$`)

func credentialEnvironment(scope string, keyName string) (string, error) {
	modelEnvironmentMu.Lock()
	defer modelEnvironmentMu.Unlock()
	if scope != "" && !modelScope.MatchString(scope) {
		return "", errors.New("invalid credential scope")
	}
	path := os.Getenv("TAIGUA_MODEL_ENV_FILE")
	if path != "" {
		info, err := os.Stat(path)
		if err != nil || info.Size() > 256*1024 || info.Mode().Perm()&0007 != 0 {
			return "", errors.New("model environment unavailable")
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return "", errors.New("model environment unavailable")
		}
		entries := map[string]string{}
		for _, line := range strings.Split(string(body), "\n") {
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			key, value, ok := strings.Cut(line, "=")
			if !ok || !scopedEnvironment.MatchString(key) || !modelSecret.MatchString(value) {
				return "", errors.New("invalid model environment")
			}
			entries[key] = value
		}
		if scope != "" {
			key := "TG_" + scope + "_" + keyName
			if secret, ok := entries[key]; ok {
				os.Setenv(key, secret)
				return key, nil
			}
			os.Unsetenv(key)
		}
	}
	return keyName, nil
}
func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
func sendJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
func (a *app) persistEvent(e event) {
	if e.Transcript == nil {
		e.Transcript = []transcript{}
	}
	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	path := filepath.Join(a.stateDir, "events", e.ID+".json")
	if err = os.WriteFile(path, data, 0600); err != nil {
		slog.Error("event persistence failed", "callId", e.AttemptID)
		return
	}
}
// 中文注释：发送积累的通话事件并处理回传结果。
func (a *app) flush(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	client := &http.Client{Timeout: 10 * time.Second}
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.flushHandoffs(ctx)
			files, _ := filepath.Glob(filepath.Join(a.stateDir, "events", "*.json"))
			for _, file := range files {
				body, err := os.ReadFile(file)
				if err != nil {
					continue
				}
				stamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
				mac := hmac.New(sha256.New, []byte(a.token))
				mac.Write([]byte(stamp + ":"))
				mac.Write(body)
				req, err := http.NewRequestWithContext(ctx, "POST", a.callback, bytes.NewReader(body))
				if err != nil {
					continue
				}
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Sip-Timestamp", stamp)
				req.Header.Set("X-Sip-Signature", hex.EncodeToString(mac.Sum(nil)))
				response, err := client.Do(req)
				if err != nil {
					continue
				}
				io.Copy(io.Discard, response.Body)
				response.Body.Close()
				if response.StatusCode >= 200 && response.StatusCode < 300 {
					os.Remove(file)
				}
			}
		}
	}
}
func (a *app) emit(id, state, reason string) {
	e := event{ID: uuid.NewString(), AttemptID: id, State: state, At: time.Now().UTC().Format(time.RFC3339Nano), Reason: reason}
	if raw, ok := a.calls.Load(id); ok {
		c := raw.(*call)
		c.mu.Lock()
		if c.Model != nil {
			e.ModelUsage = c.Model.UsageSnapshot()
		}
		c.mu.Unlock()
	}
	a.persistEvent(e)
}

// postLiveTranscript is deliberately asynchronous and fail-open. Real-time
// intent recognition must never hold the SIP/media loop on an API or Redis
// hiccup; the terminal event remains the durable source of truth.
func (a *app) postLiveTranscript(id, text, timestamp, scope string, messageIDs ...string) {
	a.postLiveTranscriptContext(id, text, timestamp, scope, "", messageIDs...)
}

func (a *app) postLiveTranscriptContext(id, text, timestamp, scope, previousAgent string, messageIDs ...string) {
	text = boundRunes(strings.TrimSpace(text), 6000)
	if text == "" || a.callback == "" {
		return
	}
	url := strings.TrimSuffix(a.callback, "/events") + "/live-transcript"
	messageID := uuid.NewString()
	if len(messageIDs) > 0 && messageIDs[0] != "" {
		messageID = messageIDs[0]
	}
	payload, err := json.Marshal(liveTranscriptEvent{
		AttemptID:     id,
		MessageID:     messageID,
		Speaker:       "customer",
		Scope:         scope,
		Text:          text,
		Timestamp:     timestamp,
		PreviousAgent: boundRunes(strings.TrimSpace(previousAgent), 6000),
	})
	if err != nil {
		return
	}
	token := a.token
	go func() {
		stamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
		mac := hmac.New(sha256.New, []byte(token))
		_, _ = mac.Write([]byte(stamp + ":"))
		_, _ = mac.Write(payload)
		req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Sip-Timestamp", stamp)
		req.Header.Set("X-Sip-Signature", hex.EncodeToString(mac.Sum(nil)))
		response, err := (&http.Client{Timeout: 2 * time.Second}).Do(req)
		if err != nil {
			slog.Warn("live transcript delivery failed", "attemptId", id, "error", err)
			return
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			slog.Warn("live transcript delivery rejected", "attemptId", id, "status", response.StatusCode)
		}
	}()
}
// 中文注释：校验语音桥内部管理请求的访问凭据。
func (a *app) authorize(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		expected := "Bearer " + a.token
		if a.token == "" || subtle.ConstantTimeCompare([]byte(expected), []byte(r.Header.Get("Authorization"))) != 1 {
			http.Error(w, "unauthorized", 401)
			return
		}
		next(w, r)
	}
}
func (a *app) ready() bool { return a.live && a.link.IsUp() && os.Getenv(a.profile.APIKeyEnv) != "" }

// An ESL connection alone does not prove that the external profile can route calls.
func (a *app) externalReady() bool {
	if !a.link.IsUp() {
		return false
	}
	result, err := a.link.API("sofia status profile external")
	if err != nil {
		return false
	}
	addresses := map[string]netip.Addr{}
	for _, row := range strings.Split(result, "\n") {
		fields := strings.Fields(row)
		if len(fields) != 2 {
			continue
		}
		switch fields[0] {
		case "SIP-IP", "RTP-IP", "Ext-SIP-IP", "Ext-RTP-IP":
			addr, parseErr := netip.ParseAddr(fields[1])
			if parseErr != nil || !addr.Is4() || !addr.IsGlobalUnicast() || addr.IsLoopback() {
				return false
			}
			if strings.HasPrefix(fields[0], "Ext-") && addr.IsPrivate() {
				return false
			}
			addresses[fields[0]] = addr
		}
	}
	return len(addresses) == 4
}
func validate(v request) error {
	if v.WorkspaceID != "" && !workspaceIdentifier.MatchString(v.WorkspaceID) {
		return errors.New("invalid workspace identifier")
	}
	if v.Audio != nil && !media.ValidNetworkJitterMs(v.Audio.NetworkJitterMs) {
		return errors.New("invalid network jitter setting")
	}
	if v.CredentialScope != "" && !modelScope.MatchString(v.CredentialScope) {
		return errors.New("invalid credential scope")
	}
	if v.Mode != "" && v.Mode != "AI" && v.Mode != "MANUAL" {
		return errors.New("invalid mode")
	}
	if err := v.SpeechSynthesis.Validate(); err != nil {
		return err
	}
	if err := validateOpeningInterruptionRules(v.OpeningInterruptionRules); err != nil {
		return err
	}
	if len(v.IntentRules) > 100 {
		return errors.New("too many intent rules")
	}
	for _, rule := range v.IntentRules {
		if strings.TrimSpace(rule.ID) == "" || len([]rune(rule.ID)) > 80 || strings.ContainsAny(rule.ID, "\r\n\t") || !validIntent(rule.Intent) {
			return errors.New("invalid intent rule")
		}
		for _, phrase := range append(append(append([]string{}, rule.Keywords...), rule.PositiveKeywords...), rule.NegativeKeywords...) {
			if len([]rune(strings.TrimSpace(phrase))) == 0 || len([]rune(phrase)) > 80 {
				return errors.New("invalid intent phrase")
			}
		}
	}
	if len(v.AssistantDetectionRules) > 100 {
		return errors.New("too many assistant detection rules")
	}
	assistantIDs := make(map[string]bool, len(v.AssistantDetectionRules))
	for _, rule := range v.AssistantDetectionRules {
		if rule.MatchMode != "" && rule.MatchMode != "semantic" && rule.MatchMode != "keyword" {
			return errors.New("invalid assistant detection match mode")
		}
		if strings.TrimSpace(rule.ID) == "" || len([]rune(rule.ID)) > 80 || strings.ContainsAny(rule.ID, "\r\n\t") || assistantIDs[rule.ID] || strings.TrimSpace(rule.Name) == "" || len([]rune(rule.Name)) > 120 || len(rule.Keywords) < 1 {
			return errors.New("invalid assistant detection rule")
		}
		assistantIDs[rule.ID] = true
		for _, phrase := range append(append([]string{}, rule.Keywords...), rule.NegativeKeywords...) {
			if len([]rune(strings.TrimSpace(phrase))) == 0 || len([]rune(phrase)) > 120 {
				return errors.New("invalid assistant detection phrase")
			}
		}
	}
	if v.Mode == "MANUAL" && !phone.MatchString(v.EmployeePhone) {
		return errors.New("invalid employee phone")
	}

	if _, err := uuid.Parse(v.ID); err != nil {
		return errors.New("invalid call identifier")
	}
	if v.Line.CallerMode != "" && v.Line.CallerMode != "custom" && v.Line.CallerMode != "provider" {
		return errors.New("invalid caller mode")
	}
	if !phone.MatchString(v.Phone) || (v.Line.CallerMode != "provider" || v.Line.Caller != "") && !caller.MatchString(v.Line.Caller) || !safePrefix.MatchString(v.Line.Prefix) || !safePrefix.MatchString(v.Line.EmployeePrefix) {
		return errors.New("invalid dial format")
	}
	ip, err := netip.ParseAddr(v.Line.ServerIP)
	if err != nil || !ip.Is4() || v.Line.Port < 1 || v.Line.Port > 65535 {
		return errors.New("invalid SIP address")
	}
	if v.Line.Transport != "udp" && v.Line.Transport != "tcp" {
		return errors.New("unsupported transport")
	}
	if len(v.Line.Codecs) < 1 || len(v.Line.Codecs) > 2 {
		return errors.New("invalid codecs")
	}
	for _, c := range v.Line.Codecs {
		if c != "PCMA" && c != "PCMU" {
			return errors.New("unsupported codec")
		}
	}
	if v.Duration < 60 || v.Duration > 900 || len(v.Instructions) > 100000 || len(v.Opening) > 6000 {
		return errors.New("invalid conversation settings")
	}
	if v.RingTimeout != 0 && (v.RingTimeout < 5 || v.RingTimeout > 120) {
		return errors.New("invalid ring timeout")
	}
	return nil
}
func supportedModel(model string) bool {
	switch model {
	case "stepaudio-2.5-realtime", "step-1o-audio", "", "qwen-audio-3.1-realtime-plus", "qwen3.8-omni-flash-realtime", "qwen3.5-omni-plus-realtime", "qwen3.5-omni-flash-realtime":
		return true
	}
	return false
}
func modelKeyName(model string) string {
	if model == "stepaudio-2.5-realtime" || model == "step-1o-audio" {
		return "STEPFUN_API_KEY"
	}
	return "DASHSCOPE_API_KEY"
}
// 中文注释：为本通请求选择对应的模型配置和凭据作用域。
func (a *app) callProfile(v request) provider.Profile {
	p := a.profile
	if modelKeyName(v.RealtimeModel) == "STEPFUN_API_KEY" {
		p = provider.StepFunProfile()
		if v.RealtimeModel == "step-1o-audio" {
			p.Voice = "linjiajiejie"
		}
	}
	if key, err := credentialEnvironment(v.CredentialScope, modelKeyName(v.RealtimeModel)); err == nil {
		p.APIKeyEnv = key
	}
	if v.RealtimeModel != "" {
		p.Model = v.RealtimeModel
	}
	if p.Name != "stepfun" && p.Model != "qwen-audio-3.1-realtime-plus" {
		p.Voice = "Tina"
		p.AcceptsTemperature = false
		if strings.HasPrefix(p.Model, "qwen3.8-omni-") {
			p.SemanticTurnType, p.SemanticTurnSilenceMs = "semantic_vad_ec", 0
		} else if strings.HasPrefix(p.Model, "qwen3.5-omni-") {
			p.SemanticTurnType, p.SemanticTurnSilenceMs = "semantic_vad", 0
		}
	}
	return p
}
// 中文注释：接收应用派发的呼叫请求，核对参数后建立本通会话和外呼。
func (a *app) originate(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "method not allowed", 405)
		return
	}
	var v request
	if json.NewDecoder(io.LimitReader(r.Body, 2000000)).Decode(&v) != nil || validate(v) != nil || !supportedModel(v.RealtimeModel) {
		http.Error(w, "invalid call", 400)
		return
	}
	if v.RingTimeout == 0 {
		v.RingTimeout = 15
	}
	a.dispatchMu.Lock()
	defer a.dispatchMu.Unlock()
	path := filepath.Join(a.stateDir, "requests", v.ID+".json")
	if _, err := os.Stat(path); err == nil {
		sendJSON(w, map[string]any{"accepted": true, "duplicate": true})
		return
	}
	var synthesis *provider.SpeechSynthesis
	if v.SpeechSynthesis != nil {
		var err error
		synthesis, err = provider.EffectiveSpeechSynthesis(v.CredentialScope, a.callProfile(v).Model, v.Voice, v.SpeechSynthesis)
		if err != nil {
			slog.Warn("speech synthesis settings rejected", "attemptId", v.ID)
			http.Error(w, "invalid speech synthesis settings", 400)
			return
		}
	}
	key, keyErr := credentialEnvironment(v.CredentialScope, modelKeyName(v.RealtimeModel))
	if !(a.live && a.externalReady() && (v.Mode == "MANUAL" || keyErr == nil && os.Getenv(key) != "")) {
		http.Error(w, "voice service not ready", 503)
		return
	}
	if a.max > 0 && a.pending.Load() >= int64(a.max) {
		a.emit(v.ID, "FAILED", "SERVICE_BUSY")
		sendJSON(w, map[string]bool{"accepted": false})
		return
	}
	v.CustomerID = ""
	if v.Mode == "MANUAL" {
		v.CustomerID = uuid.NewString()
	}
	data, _ := json.Marshal(v)
	// Persist before sending: restart never repeats an uncertain originate.
	if err := os.WriteFile(path, data, 0600); err != nil {
		http.Error(w, "cannot persist call", 503)
		return
	}
	c := &call{Req: v, Synthesis: synthesis, Started: time.Now(), CustomerID: v.CustomerID}
	a.calls.Store(v.ID, c)
	a.pending.Add(1)
	record := ""
	if v.Record {
		record = ",record_stereo=true,execute_on_answer_2='record_session " + filepath.Join(a.recordDir, v.ID+".wav") + "'"
	}
	dial := func(prefix, n string) string {
		return "sofia/external/" + prefix + n + "@" + net.JoinHostPort(v.Line.ServerIP, strconv.Itoa(v.Line.Port)) + ";transport=" + v.Line.Transport
	}
	callerVariables := ""
	if v.Line.Caller != "" {
		callerVariables = ",origination_caller_id_number=" + v.Line.Caller
	}
	ringTimeout := strconv.Itoa(v.RingTimeout)
	jitter := networkJitterVariables(v)
	vars := "{origination_uuid=" + v.ID + callerVariables + ",absolute_codec_string='" + strings.Join(v.Line.Codecs, ",") + "',ignore_early_media=true,originate_timeout=" + ringTimeout + ",taigua_attempt_id=" + v.ID + ",hangup_after_bridge=true" + jitter + record + "}"
	endpoint := dial(v.Line.Prefix, v.Phone)
	bot := "&bridge({sip_h_X-Taigua-Attempt-Id=" + v.ID + "}sofia/internal/taigua@127.0.0.1:6060)"
	if v.Mode == "MANUAL" {
		vars = "{origination_uuid=" + v.ID + callerVariables + ",absolute_codec_string='" + strings.Join(v.Line.Codecs, ",") + "',ignore_early_media=true,originate_timeout=30,taigua_parent_id=" + v.ID + ",hangup_after_bridge=true}"
		endpoint = dial(v.Line.EmployeePrefix, v.EmployeePhone)
		bot = "&bridge({origination_uuid=" + c.CustomerID + ",taigua_attempt_id=" + v.ID + callerVariables + ",ignore_early_media=true,originate_timeout=" + ringTimeout + ",call_timeout=" + ringTimeout + ",execute_on_answer_1='sched_hangup +" + strconv.Itoa(v.Duration) + " NORMAL_CLEARING'" + jitter + record + "}" + dial(v.Line.Prefix, v.Phone) + ")"
	}
	result, err := a.link.BgAPI("originate " + vars + endpoint + " " + bot)
	// The ESL client returns the background job UUID, not the raw +OK reply.
	_, jobErr := uuid.Parse(result)
	if err != nil || jobErr != nil {
		// Ambiguous delivery is quarantined in both services. Do not retry.
		c.mu.Lock()
		c.Failed = true
		c.mu.Unlock()
		http.Error(w, "dispatch outcome unknown", 502)
		return
	}
	c.mu.Lock()
	c.OriginateJobID = result
	c.mu.Unlock()
	a.emit(v.ID, "DIALING", "")
	sendJSON(w, map[string]bool{"accepted": true})
}
// 中文注释：组织单通电话的模型、媒体、识别和业务事件处理。
func (a *app) onCall(d *voice.Dialog) {
	var id string
	for k, v := range d.CustomHeaders {
		if strings.EqualFold(k, "X-Taigua-Attempt-Id") {
			id = v
		}
	}
	raw, ok := a.calls.Load(id)
	if !ok {
		d.Stop()
		return
	}
	c := raw.(*call)
	c.mu.Lock()
	if c.Finished || c.Dialog != nil {
		c.mu.Unlock()
		d.Stop()
		return
	}
	c.Dialog = d
	c.mu.Unlock()
	profile := a.callProfile(c.Req)
	callLog := slog.Default().With("attemptId", id, "workspaceId", c.Req.WorkspaceID, "demo", c.Req.DemoCall)
	failSetup := func(stage string, err error) {
		info := provider.StartupFailureInfo(err)
		callLog.Error("voice session startup failed", "provider", profile.Name, "model", profile.Model, "stage", stage, "providerStage", info.Stage,
			"errorKind", info.Kind, "providerCode", info.Code, "httpStatus", info.HTTPStatus)
		c.mu.Lock()
		c.Failed = true
		c.mu.Unlock()
		d.Stop()
	}
	_, keyErr := credentialEnvironment(c.Req.CredentialScope, modelKeyName(c.Req.RealtimeModel))
	if keyErr != nil {
		failSetup("credential", keyErr)
		return
	}
	language := c.Req.Language
	switch language {
	case "zh-CN", "zh-HK", "auto":
		language = "zh"
	case "en":
	default:
		language = "zh"
	}
	instructions := c.Req.Instructions
	if c.Req.DemoCall {
		instructions += demoConversationPolicy(language)
	} else {
		instructions += "\n回答语言：" + c.Req.Language + "\n【电话对话节奏】开场白在接通时开始一次；被打断而尚未听到的内容不算已经介绍完。客户说喂、嗯、你好或短暂沉默时，不重新自我介绍，不从开场白重来。客户问哪位或哪家公司时先回答身份，再按本通播放状态自然接续未听到的必要业务内容，不用一句泛化来意替代配置介绍。每次只说一两句、只问一个问题，等客户回答；不要连续朗读整段介绍。没听清时只简短请对方重说，不猜测客户答复。客户明确说不方便、拒绝或告别时，简短回应并调用结束工具，不继续推销。保持自然口语，不念流程标题、舞台指示或括号中的停顿提示。"
		instructions += dialoguePolicyFor(c.Req.SystemSpeech, language)
		instructions += knowledgeInstructions
	}
	audio := media.DefaultAudioSettings()
	if c.Req.Audio != nil && c.Req.Audio.Valid() {
		audio = *c.Req.Audio
	}
	d.RTP.SetBackgroundScene(audio.BackgroundScene, audio.BackgroundVolume)
	turn := configuredConversationTurn(audio, profile)
	if c.Req.DemoCall && !strings.HasPrefix(profile.Model, "qwen3.8-omni-") && turn.Mode == provider.TurnModeSemantic {
		turn.SilenceMs = 600
	}
	callLog.Info("conversation timing configured", "silenceMs", turn.SilenceMs, "mode", turn.Mode, "detector", profile.SemanticTurnType, "threshold", turn.Threshold)
	var flow *flowRuntime
	if !c.Req.DemoCall {
		flow = newFlowRuntime(c.Req.Flow)
	}
	if c.Req.AssistantDetectionRules == nil || len(c.Req.AssistantDetectionRules) > 0 {
		instructions += "\n【语音助手识别与工作指令执行】AI 工作指令中的身份、回答范围和结束条件必须执行，不能只用于展示。对方明确自称小爱同学、小艺、机主的智能助理、机主的智能助手、电话助理、机器人代接助手，或播报转至语音留言、语音信箱、机主无法接听等代接提示时，立即调用 hangup_answering_assistant，并引用实际听到的代接提示原文作为 evidence。例如“您拨打的电话正在通话中，我是机主的智能助理，您有什么事可以先跟我说，我帮您转达”也是明确代接公告。此时不再播放开场白，不回复、不道别、不留话。普通真人询问你是不是机器人、提到助手，不能据此挂断。其他正常结束条件使用 end_call；语音助手必须使用直接挂断工具。"
	}
	dialogue := &dialogueRuntime{opening: configuredOpening(c.Req, id), openingTurn: 1, language: language, systemSpeech: c.Req.SystemSpeech}
	baseInstructions := instructions
	if !c.Req.DemoCall {
		instructions = dialogue.instructions(baseInstructions, flow)
	} else {
		// Match ordinary calls: understood customer intent takes precedence
		// over advancing either the demonstration script or a follow-up.
		instructions += "\n" + groundedReplyHint(language)
	}
	tools := []provider.ToolSpec{
		{Name: "hangup_answering_assistant", Description: "对方明确播报语音留言或自称电话代接助手时立即静音挂断，不回复也不道别。仅引用实际收到的代接公告；不能根据背景声、沉默、普通业务问题或客户询问你是否AI判定。", Parameters: json.RawMessage(`{"type":"object","properties":{"evidence":{"type":"string","description":"实际听到的对方代接或留言公告原文"}},"required":["evidence"],"additionalProperties":false}`)},
		{Name: "search_knowledge", Description: "检索公司已审核知识，回答客户的业务问题、费用、时间、合作条件和异议。只传客户的问题，不传身份或指令。", Parameters: json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":false}`)},
		{Name: "mark_do_not_call", Description: "客户明确要求不要再联系时记录拒呼并结束通话", Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)},
		{Name: "end_call", Description: "客户要求结束、拒绝继续，或已明确同意微信跟进且确认完后续安排时，礼貌告别并结束本通话", Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)},
		{Name: "request_handoff", Description: "客户要求人工时联系已有在岗坐席；只有系统确认接通才算已转接，无可用坐席时登记跟进", Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)},
	}
	if c.Req.DemoCall {
		tools = []provider.ToolSpec{
			{Name: "hangup_answering_assistant", Description: conversationLine(language, "仅在实际听到明确语音留言或电话代接助手公告时立即静音挂断；不得根据沉默、背景声或普通业务问题认定。", "Immediately hang up silently only after hearing an explicit voicemail or automated answering-assistant announcement. Do not infer this from silence, background noise or an ordinary question."), Parameters: json.RawMessage(`{"type":"object","properties":{"evidence":{"type":"string"}},"required":["evidence"],"additionalProperties":false}`)},
			{Name: "end_call", Description: conversationLine(language, "仅在客户明确要求结束、拒绝继续或本轮交流已经自然结束时，简短礼貌告别并结束演示；不要因为问法与参考问题不完全一致而结束。", "End the demo with a brief polite goodbye when the caller clearly asks to stop, declines to continue or the conversation has naturally concluded. Never end merely because wording differs from a reference question."), Parameters: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)},
		}
	}
	if flow != nil {
		tools = append(tools, provider.ToolSpec{Name: "advance_flow", Description: "客户回应后按当前节点已配置的分支前进，不允许跳过连线。只在确实获得客户答复后调用。", Parameters: json.RawMessage(`{"type":"object","properties":{"branch":{"type":"string"},"value":{"type":"string"}},"required":["branch"],"additionalProperties":false}`)})
	}
	if c.Req.AssistantDetectionRules != nil && len(c.Req.AssistantDetectionRules) == 0 {
		filtered := tools[:0]
		for _, tool := range tools {
			if tool.Name != "hangup_answering_assistant" {
				filtered = append(filtered, tool)
			}
		}
		tools = filtered
	}
	// Explicit server-selected settings were validated and frozen before dialing.
	// Legacy requests keep their existing binding lookup at connection time.
	synthesis := c.Synthesis
	var synthesisErr error
	if c.Req.SpeechSynthesis == nil {
		synthesis, synthesisErr = provider.ConfiguredSpeechSynthesis(c.Req.CredentialScope, profile.Model, c.Req.Voice)
	} else if synthesis == nil {
		synthesisErr = errors.New("speech synthesis settings were not resolved before dialing")
	}
	if synthesisErr != nil {
		failSetup("synthesis_binding", synthesisErr)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(c.Req.Duration)*time.Second)
	defer cancel()
	go func() {
		select {
		case <-d.Stopped:
			cancel()
		case <-ctx.Done():
		}
	}()
	var ending atomic.Bool
	var model *provider.Realtime
	var session *aicall.Session
	var monitor *provider.AnsweringMonitor
	// A failed initial handshake may be retried once, before any greeting or
	// audio pump exists. Both attempts share a seven-second setup budget and
	// the same telephone leg; an established conversation is never replayed.
	setupDeadline := time.Now().Add(7 * time.Second)
	for attempt := 1; attempt <= 2; attempt++ {
		if ctx.Err() != nil || d.IsStopped() {
			d.Stop()
			return
		}
		var err error
		model, err = provider.New(profile, callLog)
		if err != nil {
			failSetup("model_configuration", err)
			return
		}
		c.mu.Lock()
		if c.Finished || d.IsStopped() {
			c.mu.Unlock()
			_ = model.Close(context.Background())
			return
		}
		c.Model = model
		c.mu.Unlock()
		var conversation provider.VoiceSession = model
		if !c.Req.DemoCall && len(c.Req.Recordings) > 0 {
			recorded := provider.WithRecordings(model, c.Req.Recordings, id, func(ctx context.Context, clip provider.Recording) ([]byte, error) {
				return a.loadScriptRecording(ctx, id, clip.AssetID)
			})
			if audio.BackgroundScene == "opening" {
				recorded.OpeningObserver = d.RTP.SetOpeningAmbience
			}
			conversation = recorded
		}
		if synthesis != nil {
			scopedSynthesis := *synthesis
			scopedSynthesis.WorkspaceID = c.Req.WorkspaceID
			conversation = provider.WithSpeechSynthesis(conversation, scopedSynthesis, os.Getenv(profile.APIKeyEnv), callLog)
		}
		if c.Req.AssistantDetectionRules == nil || len(c.Req.AssistantDetectionRules) > 0 {
			monitor = model.NewAnsweringMonitor(ctx)
		}
		session, err = aicall.New(aicall.FromDialog(d), conversation, profile, aicall.Config{Session: provider.SessionConfig{Instructions: instructions, Voice: c.Req.Voice, Language: language, OpeningText: dialogue.opening, Turn: turn, Tools: tools, SetupDeadline: setupDeadline}, Audio: audio, ObserveInbound: monitor.Push, ManualDigits: flow != nil, NoInput: time.Duration(audio.NoInputSeconds) * time.Second, IsGreetingGated: true, GreetingMediaWait: time.Second, IsEndingArmed: ending.Load, Logger: callLog})
		if err != nil {
			monitor.Close()
			_ = conversation.Close(context.Background())
			failSetup("audio_session", err)
			return
		}
		c.mu.Lock()
		c.Session = session
		c.mu.Unlock()
		if err = session.Start(ctx); err == nil {
			if attempt > 1 {
				callLog.Info("voice session startup recovered", "setupAttempt", attempt)
			}
			break
		}
		// Start releases only the failed provider and its pre-start watcher;
		// Close would also hang up the leg and is deliberately not used here.
		monitor.Close()
		info := provider.StartupFailureInfo(err)
		if attempt == 2 || !info.Retryable || ctx.Err() != nil || d.IsStopped() || time.Now().Add(200*time.Millisecond).After(setupDeadline) {
			failSetup("model_session", err)
			return
		}
		callLog.Warn("retrying transient voice startup", "provider", profile.Name, "model", profile.Model, "setupAttempt", attempt, "providerStage", info.Stage,
			"errorKind", info.Kind, "providerCode", info.Code, "httpStatus", info.HTTPStatus)
		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			d.Stop()
			return
		case <-d.Stopped:
			timer.Stop()
			return
		}
	}
	defer monitor.Close()
	defer session.Close(context.Background())
	knowledgeQueries, knowledgeTotal := 0, 0
	a.emit(id, "CONNECTED", "")
	usageTicker := time.NewTicker(10 * time.Second)
	defer usageTicker.Stop()
	if flow != nil {
		a.recordFlow(c, flow.current(), "接通")
	}
	var machineTranscript answeringTranscript
	callScope := "outbound"
	if c.Req.Mode == "MANUAL" {
		callScope = "manual"
	} else if c.Req.DemoCall || c.Req.TestCall {
		callScope = "demo"
	}
	var receivedForAssistant string
	rememberInbound := func(text string) {
		receivedForAssistant += text
		if runes := []rune(receivedForAssistant); len(runes) > 1000 {
			receivedForAssistant = string(runes[len(runes)-1000:])
		}
	}
	stopMachine := func(text string, detected *assistantDetectionMatch) {
		ending.Store(true)
		now := time.Now().UTC().Format(time.RFC3339Nano)
		detected.At, detected.MessageID = now, uuid.NewString()
		c.mu.Lock()
		c.EndReason = "ANSWERING_MACHINE"
		c.AssistantDetection = detected
		// An answering announcement is not a customer's business intent.
		c.Intent, c.IntentEvidence, c.MatchedRules, c.OptOut = "", "", nil, false
		if len(c.Transcript) < 500 {
			c.Transcript = append(c.Transcript, transcript{"customer", boundRunes(text, 6000), now})
		}
		c.mu.Unlock()
		// Media and hangup never wait for the API or Redis.
		a.postLiveTranscript(id, boundRunes(text, 6000), now, callScope, detected.MessageID)
		callLog.Info("answering assistant detected; immediate hangup")
		d.RTP.ClearTx()
		d.Stop()
		session.DiscardRecording()
		monitor.Close()
	}
	var handoffTarget *handoffTarget
	handoffTurn := 0
	armed := false
	closingTurn := 0
	followUpEndingState := &followUpEnding{}
	var fixedFarewellRetry <-chan time.Time
	fixedFarewellAttempts := 0
	unheardRejectedTurns := make(map[int]bool)
	recordedBotTurns := make(map[int]bool)
	pendingBotTurns := make(map[int]string)
	cancelFollowUpEnding := func(turn int) {
		// A final transcript can trail a customer's interruption. Do not let
		// the abandoned response schedule another automatic hangup later.
		if followUpEndingState.pending > 0 || followUpEndingState.toolTurn > 0 {
			callLog.Info("follow-up closing cancelled for customer speech", "turn", turn, "pendingTurn", followUpEndingState.pending, "toolTurn", followUpEndingState.toolTurn)
		}
		followUpEndingState.cancel(turn)
		fixedFarewellRetry, fixedFarewellAttempts = nil, 0
	}
	armEnding := func(turn int) {
		followUpEndingState.pending, followUpEndingState.toolTurn, followUpEndingState.requested = 0, 0, false
		fixedFarewellRetry, fixedFarewellAttempts = nil, 0
		armed, closingTurn = true, turn
		ending.Store(true)
		session.SealAfterTurn(turn)
	}
	logEndCallDecision := func(turn int, accepted bool, reason string) {
		callLog.Info("end_call decision", "turn", turn, "accepted", accepted, "reason", reason,
			"demo", c.Req.DemoCall, "followUpSelected", dialogue.followUp == "wechat",
			"followUpFocused", dialogue.followUpFocused, "audioIssue", dialogue.audioIssue,
			"hasFragment", dialogue.fragment != "", "cancelledClosingThrough", followUpEndingState.cancelledThrough)
	}
	var recognitionWait <-chan time.Time
	callerSpeaking, speechRecognized := false, false
	var speechBegan time.Time
	var speechDuration time.Duration
	var resumeRecording <-chan time.Time
	resumeAfterGreeting := false
	unrecognized := 0
	var grace <-chan time.Time
	silent := 0
	var lastSilenceCue time.Time
	var listenAgain <-chan time.Time
	var heldSilence <-chan time.Time
	heldReply := false
	var recoveryStartedAt time.Time
	recoverySourceTurn := 0
	openingPending := &pendingOpeningSpeech{}
	openingReplay := make(chan aicall.Event, 1)
	openingReplayReady := false
	queueOpeningReply := func() {
		if openingPending.empty() || openingReplayReady || callerSpeaking || !speechRecognized || armed || session.ActiveRecording() == "opening-recordings" {
			return
		}
		openingReplay <- aicall.Event{Type: aicall.EventTypeCustomerSaid, Text: openingPending.take(), IsFinal: true}
		openingReplayReady = true
	}
	var demoLastCustomer, demoReplyText string
	demoReplyTurn := 0
	refreshDialogue := func() {
		if c.Req.DemoCall {
			return
		}
		if err := session.Reinstruct(dialogue.instructions(baseInstructions, flow)); err != nil {
			slog.Warn("could not refresh conversation context", "attemptId", id, "error", err)
		}
	}
	releaseReply := func() {
		heldReply, listenAgain, heldSilence = false, nil, nil
		resumeAfterGreeting, resumeRecording = false, nil
		session.ReleaseReply()
	}
	holdReply := func(expected ...int) bool {
		if c.Req.DemoCall {
			return false
		}
		var err error
		if len(expected) > 0 {
			var held bool
			held, err = session.HoldReplyForTurn(expected[0])
			if err == nil && !held {
				return false
			}
		} else {
			err = session.HoldReply()
		}
		if err != nil {
			slog.Warn("could not pause conversation reply", "attemptId", id, "error", err)
			return false
		}
		heldReply = true
		heldSilence = time.After(time.Duration(audio.NoInputSeconds) * time.Second)
		return true
	}
	guideReply := func(hint string, expected ...int) {
		if c.Req.DemoCall {
			return
		}
		resumeAfterGreeting, resumeRecording = false, nil
		var err error
		if len(expected) > 0 {
			var requested bool
			requested, err = session.GuideReplyForTurn(expected[0], hint)
			if err == nil && !requested {
				callLog.Info("reply guidance superseded", "sourceTurn", expected[0])
				return
			}
		} else {
			err = session.GuideReply(hint)
		}
		if err != nil {
			slog.Warn("could not resume conversation reply", "attemptId", id, "error", err)
			return
		}
		heldReply, listenAgain, heldSilence = false, nil, nil
	}
	closePolitely := func(text string) {
		if armed {
			return
		}
		turn := session.CurrentTurn()
		alreadyClosing := dialogue.streamTurn == turn && conversationFarewell(dialogue.stream, language)
		if c.Req.DemoCall {
			alreadyClosing = demoReplyTurn == turn && conversationFarewell(demoReplyText, language)
		}
		if !alreadyClosing {
			turn++
		}
		armEnding(turn)
		releaseReply()
		recognitionWait = nil
		// A farewell already being played belongs to this turn. Do not queue a
		// second goodbye or hang up on an older question's playback marker.
		if alreadyClosing {
			if !session.HasOutput() {
				d.Stop()
				return
			}
		} else {
			if err := session.Speak(text, true); err != nil {
				d.Stop()
				return
			}
		}
		grace = time.After(12 * time.Second)
	}
	silencePrompt := func() {
		if armed {
			return
		}
		releaseReply()
		next := silent + 1
		if next >= 3 {
			silent, lastSilenceCue = next, time.Now()
			closePolitely(c.Req.SystemSpeech.line(language, "noResponseEnd"))
			return
		}
		key := "noResponseFirst"
		if next >= 2 {
			key = "noResponseSecond"
		}
		text := c.Req.SystemSpeech.line(language, key)
		supported, started, err := session.SpeakFixed(text)
		if err != nil {
			callLog.Warn("could not synthesize silence prompt", "prompt", key, "error", err)
			return
		}
		if supported && !started {
			callLog.Info("silence prompt skipped on busy floor", "prompt", key)
			return
		}
		if !supported {
			if err := session.Speak(text, false); err != nil {
				d.Stop()
				return
			}
		}
		silent, lastSilenceCue = next, time.Now()
		callLog.Info("silence prompt requested", "prompt", key, "directSynthesis", supported)
	}
	resolveFollowUpEnding := func() bool {
		turn := session.CurrentTurn()
		action := followUpEndingState.resolve(dialogue, turn, armed, callerSpeaking, recognitionWait != nil)
		if action == 1 {
			armEnding(turn)
			callLog.Info("follow-up farewell playback completed", "turn", turn)
			d.Stop()
			return true
		}
		if action == 2 || action == 3 {
			text := c.Req.SystemSpeech.line(language, "goodbye")
			if action == 3 {
				text = c.Req.SystemSpeech.line(language, "followUp")
			}
			supported, started, err := session.SpeakFixed(text)
			if err != nil {
				callLog.Warn("could not synthesize follow-up farewell", "turn", turn+1, "error", err)
				return false
			}
			if supported && !started {
				fixedFarewellAttempts++
				if fixedFarewellAttempts <= 20 {
					fixedFarewellRetry = time.After(250 * time.Millisecond)
				} else {
					callLog.Warn("follow-up farewell floor remained busy", "turn", turn)
				}
				return false
			}
			if !supported {
				if err := session.Speak(text, false); err != nil {
					callLog.Warn("could not request follow-up farewell", "turn", turn+1, "error", err)
					return false
				}
			}
			fixedFarewellRetry, fixedFarewellAttempts = nil, 0
			followUpEndingState.pending, followUpEndingState.requested = turn+1, true
			callLog.Info("follow-up farewell requested", "turn", turn+1, "directSynthesis", supported)
		}
		return false
	}
	scheduleRecording := func() {
		if c.Req.DemoCall {
			return
		}
		resumeAfterGreeting = true
		if !callerSpeaking {
			resumeRecording = time.After(350 * time.Millisecond)
		}
	}
	for {
		events := session.Events()
		if openingReplayReady {
			events = openingReplay
		}
		select {
		case text := <-monitor.Texts():
			rememberInbound(text)
			if detected := matchAssistantDetection(text, c.Req.AssistantDetectionRules); detected != nil {
				stopMachine(text, detected)
				return
			}
		case <-resumeRecording:
			resumeRecording = nil
			if c.Req.DemoCall || armed || callerSpeaking || !resumeAfterGreeting {
				continue
			}
			resumeTurn := session.CurrentTurn() + 1
			key, resumeErr := session.ResumeRecording()
			if resumeErr != nil {
				callLog.Warn("could not resume original recording", "error", resumeErr)
				guideReply("原录音暂时无法继续，简短回应客户最新意思，不从头重复开场。")
			} else {
				releaseReply()
				if key == "opening-recordings" {
					dialogue.openingTurn = resumeTurn
				}
			}
		case <-recognitionWait:
			recognitionWait = nil
			if !armed && !callerSpeaking && !speechRecognized {
				if turn.Mode == provider.TurnModeSemantic {
					// Semantic detection may discard room sounds without a
					// transcript. They must not trigger a new spoken repair.
					if !c.Req.DemoCall && session.PausedRecording() != "" {
						scheduleRecording()
					}
					callLog.Info("untranscribed sound left the conversation unchanged")
					continue
				}
				if !c.Req.DemoCall && session.PausedRecording() != "" {
					if speechDuration > 0 && speechDuration <= 700*time.Millisecond {
						// Brief nonverbal sound: resume without an extra model turn.
						scheduleRecording()
					} else {
						session.DiscardRecording()
						guideReply("刚才客户的发言没有识别清楚。只简短请他再说一下，不猜问题、不重播开场。")
					}
					continue
				}
				unrecognized++
				callLog.Info("speech ended without a usable transcript", "consecutive", unrecognized)
				if unrecognized == 1 && !heldReply {
					_ = session.Speak(c.Req.SystemSpeech.line(language, "unclear"), false)
				}
			}
		case <-usageTicker.C:
			a.emit(id, "CONNECTED", "")
		case <-fixedFarewellRetry:
			fixedFarewellRetry = nil
			if resolveFollowUpEnding() {
				return
			}
		case <-ctx.Done():
			d.Stop()
			return
		case <-d.Stopped:
			return
		case <-grace:
			callLog.Warn("closing grace expired", "closingTurn", closingTurn, "currentTurn", session.CurrentTurn(), "hasOutput", session.HasOutput())
			d.Stop()
			return
		case <-heldSilence:
			heldSilence = nil
			if heldReply && !armed && !callerSpeaking && recognitionWait == nil {
				silencePrompt()
			}
		case <-listenAgain:
			listenAgain = nil
			if !c.Req.DemoCall && heldReply && !armed && !dialogue.listeningCue {
				refreshDialogue()
				// One listening cue per customer turn, with no business question
				// restart. A continuing customer keeps the floor in the provider.
				dialogue.listeningCue = true
				guideReply("客户刚才的话可能未说完或未听清。若客户仍在说话就等待；否则只简短邀请他补充刚才那半句话，不重问任何已问过的业务问题，也不重新自我介绍。")
			}
		case e, ok := <-events:
			isOpeningReplay := openingReplayReady
			if isOpeningReplay {
				openingReplayReady = false
			}
			if !ok {
				return
			}
			switch e.Type {
			case aicall.EventTypeBargeIn:
				// Barge-in events currently omit Turn; the stream processed
				// before this event identifies the response being interrupted.
				cancelFollowUpEnding(max(e.Turn, dialogue.streamTurn))
			case aicall.EventTypeTurnDone:
				if e.IsInterrupted && followUpEndingState.pending == e.Turn {
					cancelFollowUpEnding(e.Turn)
				}
			case aicall.EventTypeSpeechStarted:
				cancelFollowUpEnding(e.Turn)
				callerSpeaking, speechRecognized = true, false
				speechBegan, speechDuration = time.Now(), 0
				resumeAfterGreeting, resumeRecording = false, nil
				recognitionWait = nil
				silent = 0
				callLog.Info("customer speech detected", "turn", e.Turn)
			case aicall.EventTypeSpeechStopped:
				callerSpeaking = false
				if !speechBegan.IsZero() {
					speechDuration = time.Since(speechBegan)
				}
				if resumeAfterGreeting {
					scheduleRecording()
				}
				if !speechRecognized && !armed && session.ActiveRecording() == "" {
					recognitionWait = time.After(2200 * time.Millisecond)
				}
				queueOpeningReply()
				// A recognized customer's speech-stop may trail both the final
				// farewell and its playback. Re-evaluate without another bot turn.
				if resolveFollowUpEnding() {
					return
				}
			case aicall.EventTypeCustomerSaid, aicall.EventTypeBotSaid:
				openingHeld, openingSubstantive := false, true
				if e.Type == aicall.EventTypeCustomerSaid && !isOpeningReplay {
					if e.Text != "" {
						cancelFollowUpEnding(dialogue.streamTurn)
					}
					rememberInbound(e.Text)
					text := machineTranscript.add(e.Text, e.IsFinal)
					detected := matchAssistantDetection(e.Text, c.Req.AssistantDetectionRules)
					if detected == nil {
						detected = matchAssistantDetection(text, c.Req.AssistantDetectionRules)
					}
					if detected != nil {
						stopMachine(detected.Evidence, detected)
						return
					}
				}
				if e.Type == aicall.EventTypeCustomerSaid && e.IsFinal && strings.TrimSpace(e.Text) != "" && !isOpeningReplay && !armed {
					activeOpening := session.ActiveRecording() == "opening-recordings"
					openingSubstantive = openingSpeechSubstantive(e.Text, c.Req.OpeningInterruptionRules)
					lock := c.Req.OpeningInterruptionRules != nil && c.Req.OpeningInterruptionRules.LockOpening
					// An opening lock protects the introduction from greetings,
					// never from a complete, explicit request to end the call.
					openingHeld = conversationEnding(e.Text, language) == "" && (((activeOpening || e.DuringOpening) && !openingSubstantive) || (lock && (activeOpening || !openingPending.empty())))
					if openingHeld {
						speechRecognized, recognitionWait, silent = true, nil, 0
						if openingSubstantive && lock {
							openingPending.add(e.Text)
						}
						callLog.Info("opening speech gated", "locked", lock, "substantive", openingSubstantive, "recordingActive", activeOpening)
					} else if activeOpening {
						session.BargeInForSpeech()
						callLog.Info("opening interrupted by substantive speech")
					}
				}
				if e.Type == aicall.EventTypeCustomerSaid && e.IsFinal && e.Text == "" && !armed && session.ActiveRecording() == "" {
					speechRecognized = false
					recognitionWait = time.After(2200 * time.Millisecond)
				}
				if e.Type == aicall.EventTypeBotSaid && c.Req.DemoCall {
					// Keep only enough playback state to avoid a duplicate goodbye.
					// Demo replies are never intercepted by the sales-flow heuristics.
					if demoReplyTurn != e.Turn {
						demoReplyTurn, demoReplyText = e.Turn, ""
					}
					if e.IsFinal {
						demoReplyText = boundedDialogue(e.Text)
					} else {
						demoReplyText = boundedDialogue(demoReplyText + e.Text)
					}
					if !armed && e.IsFinal && conversationEnding(demoLastCustomer, language) != "" && conversationFarewell(e.Text, language) {
						armEnding(e.Turn)
						recognitionWait = nil
						grace = time.After(12 * time.Second)
						callLog.Info("demo spoken closing armed ending", "turn", e.Turn)
					}
				}
				if e.Type == aicall.EventTypeBotSaid && !c.Req.DemoCall && !armed {
					replyLog := callLog.With(e.Trace.LogAttrs()...)
					if !recoveryStartedAt.IsZero() && e.Turn > recoverySourceTurn && e.Text != "" {
						replyLog.Info("voice phase", "phase", "recovery_first_text_observed", "stageAt", time.Now().UTC(), "sourceTurn", recoverySourceTurn, "recoveryToTextMs", time.Since(recoveryStartedAt).Milliseconds())
						recoveryStartedAt = time.Time{}
					}
					if followUpEndingState.pending > 0 && e.Turn > followUpEndingState.pending {
						callLog.Info("follow-up closing superseded by response", "turn", e.Turn, "pendingTurn", followUpEndingState.pending)
						followUpEndingState.pending = 0
					}
					review := botReplyReview{Turn: e.Turn, Ignored: true}
					if e.Turn == session.CurrentTurn() {
						review = reviewBotReply(dialogue, e.Text, e.IsFinal, e.Turn)
					} else {
						replyLog.Info("ignored stale reply review", "turn", e.Turn, "currentTurn", session.CurrentTurn())
					}
					if review.GuidanceOnly {
						replyLog.Info("conversation guidance kept reply", "turn", e.Turn, "repeated", review.Repeated, "unneededSurvey", review.UnneededSurvey, "regenerated", false)
					}
					if !review.Ignored && !review.Intercepted {
						mayHaveAudio := session.QueuedAudioForTurn(e.Turn)
						resolveBotReply(dialogue, review, mayHaveAudio)
						if e.IsFinal && !mayHaveAudio {
							pendingBotTurns[e.Turn] = e.Text
						}
					}
					if review.Closing {
						if followUpEndingState.observeReply(dialogue, review) {
							// Cosy emits final text before its speech finishes. Keep
							// listening until this exact turn finishes playing, so a
							// new question or audio complaint can cancel the closing.
							if e.Turn > followUpEndingState.cancelledThrough {
								if resolveFollowUpEnding() {
									return
								}
								if !callerSpeaking && recognitionWait == nil {
									resumeRecording, listenAgain, heldSilence = nil, nil, nil
								}
								callLog.Info("follow-up closing awaits playback", "turn", e.Turn, "callerSpeaking", callerSpeaking, "recognitionPending", recognitionWait != nil, "playedTurn", followUpEndingState.playedTurn)
							}
						} else if conversationEnding(dialogue.lastCustomer, language) != "" || (e.Turn > followUpEndingState.cancelledThrough && !callerSpeaking && recognitionWait == nil) {
							armEnding(e.Turn)
							recognitionWait, resumeRecording, listenAgain, heldSilence = nil, nil, nil, nil
							grace = time.After(12 * time.Second)
							callLog.Info("spoken closing armed ending", "turn", e.Turn)
						}
					} else if review.Intercepted {
						// Capture review guidance before removing this candidate. Hold
						// playback first, then check whether any audio was ever queued.
						replyLog.Info("conversation reply intercepted", "turn", e.Turn, "repeated", review.Repeated, "prematureClosing", review.Premature, "unneededSurvey", review.UnneededSurvey, "communicationRepair", review.CommunicationRepair, "communicationReason", review.CommunicationReason, "followUp", dialogue.followUp, "followUpFocused", dialogue.followUpFocused, "audioIssue", dialogue.audioIssue, "recoveryUsed", dialogue.recoveryUsed)
						if !holdReply(e.Turn) {
							replyLog.Info("reply review superseded before holding", "sourceTurn", e.Turn)
							continue
						}
						mayHaveAudio := session.QueuedAudioForTurn(e.Turn)
						resolveBotReply(dialogue, review, mayHaveAudio)
						if !mayHaveAudio {
							unheardRejectedTurns[e.Turn] = true
						}
						callLog.Info("conversation reply context resolved", "turn", e.Turn, "unheardDraftDiscarded", !mayHaveAudio, "possiblePartialAudio", mayHaveAudio)
						refreshDialogue()
						if !dialogue.recoveryUsed && dialogue.fragment == "" {
							dialogue.recoveryUsed = true
							recoveryStartedAt, recoverySourceTurn = time.Now(), e.Turn
							replyLog.Info("voice phase", "phase", "reply_recovery_requested", "stageAt", recoveryStartedAt.UTC(), "sourceTurn", e.Turn, "recoveryLimit", 1)
							guideReply(review.RecoveryHint, e.Turn)
						} else if heldReply && dialogue.fragment != "" && !dialogue.listeningCue {
							listenAgain = time.After(1800 * time.Millisecond)
						} else {
							// Do not restart the repair through the listening-cue timer.
							// A new customer utterance gets its normal automatic reply.
							listenAgain = nil
							replyLog.Info("reply recovery budget exhausted", "turn", e.Turn, "waitingForCustomer", true)
						}
					}
				}
				if e.IsFinal && e.Text != "" && (e.Type == aicall.EventTypeCustomerSaid || (!unheardRejectedTurns[e.Turn] && !recordedBotTurns[e.Turn])) {
					speaker := "agent"
					if e.Type == aicall.EventTypeCustomerSaid {
						transcriptAt := time.Now().UTC().Format(time.RFC3339Nano)
						c.mu.Lock()
						previousIntentAgent := ""
						// Never carry a short yes across another customer's answer.
						// Only the last recorded agent turn can supply its referent.
						if count := len(c.Transcript); count > 0 && c.Transcript[count-1].Speaker == "agent" {
							previousIntentAgent = c.Transcript[count-1].Text
						}
						c.mu.Unlock()
						// Publish the actual adjacent recorded agent turn with each
						// final reply so the API can adjudicate weak affirmatives.
						// Delivery remains asynchronous and never delays the media loop.
						if !isOpeningReplay && (!openingHeld || openingSubstantive) {
							a.postLiveTranscriptContext(id, e.Text, transcriptAt, callScope, previousIntentAgent)
							if matched := matchIntentRules(e.Text, c.Req.IntentRules, callScope, previousIntentAgent); matched != nil {
								c.mu.Lock()
								c.Intent, c.IntentEvidence = matched.Intent, matched.Evidence
								for _, rule := range matched.Rules {
									if len(c.MatchedRules) < 100 && !hasRuleMatch(c.MatchedRules, rule.ID, rule.Keyword) {
										c.MatchedRules = append(c.MatchedRules, rule)
									}
								}
								c.mu.Unlock()
							}
						}
						knowledgeQueries = 0
						speechRecognized, recognitionWait, unrecognized = true, nil, 0
						callLog.Info("customer transcript received", "characters", len([]rune(e.Text)))
						speaker = "customer"
						if !recoveryStartedAt.IsZero() {
							callLog.Info("voice phase", "phase", "reply_recovery_superseded_by_customer", "sourceTurn", recoverySourceTurn, "waitMs", time.Since(recoveryStartedAt).Milliseconds())
							recoveryStartedAt = time.Time{}
						}
						silent = 0
						if c.Req.DemoCall && !openingHeld {
							demoLastCustomer = boundedDialogue(e.Text)
							if reason := conversationEnding(e.Text, language); !armed && reason != "" {
								callLog.Info("customer ending confirmed", "reason", reason, "demo", true)
								session.DiscardRecording()
								closePolitely(c.Req.SystemSpeech.line(language, "declined"))
							}
						}
						if !c.Req.DemoCall && !armed && !openingHeld {
							pausedRecording := session.PausedRecording()
							interruptedBotTurn := dialogue.streamTurn
							if interruptedBotTurn > 0 {
								// QueuedAudioForTurn is intentionally conservative for old
								// turns.  Only consult it while that turn is still current;
								// otherwise a later response could make an unheard old draft
								// look partially delivered and pollute the next context.
								if session.CurrentTurn() == interruptedBotTurn {
									if session.QueuedAudioForTurn(interruptedBotTurn) {
										dialogue.preserveBotContext(interruptedBotTurn)
									} else if dialogue.rejectUnheardBot(interruptedBotTurn) {
										unheardRejectedTurns[interruptedBotTurn] = true
									}
								}
								delete(pendingBotTurns, interruptedBotTurn)
							}
							unfinished := dialogue.customer(e.Text)
							refreshDialogue()
							if reason := conversationEnding(e.Text, language); reason != "" {
								callLog.Info("customer ending confirmed", "reason", reason, "demo", false)
								if reason == "opt_out" {
									c.mu.Lock()
									c.OptOut = true
									c.mu.Unlock()
								}
								session.DiscardRecording()
								closePolitely(c.Req.SystemSpeech.line(language, "declined"))
							} else if dialogue.audioIssue && !unfinished {
								session.DiscardRecording()
								resumeAfterGreeting, resumeRecording = false, nil
								guideReply(dialogue.communicationHint())
							} else if dialogue.acceptedFollowUpReady() && !unfinished {
								session.DiscardRecording()
								callLog.Info("accepted follow-up invitation; closing without another question")
								key := "goodbye"
								if dialogue.followUp == "wechat" {
									key = "followUp"
								}
								closePolitely(c.Req.SystemSpeech.line(language, key))
							} else if dialogue.followUpFocused && !unfinished {
								session.DiscardRecording()
								if heldReply || pausedRecording != "" {
									guideReply(dialogue.followUpHint())
								} else {
									session.ResolveDirectReply("", e.Trace)
								}
							} else if pausedRecording != "" && dialogue.greeting(e.Text) {
								if holdReply() {
									scheduleRecording()
								}
							} else if pausedRecording == "opening-recordings" && introductionQuestion(e.Text, language) {
								// A contact check is not a business answer. Continue with
								// this agent's unheard content after answering identity,
								// rather than restarting the same identity in the recording.
								session.DiscardRecording()
								guideReply(conversationLine(language, "客户只是在核实身份或来意，尚未表达业务意向。先直接回答他问的身份或来意，再按本通状态 openingContentStillUnheard 自然接续配置中尚未听到的必要业务内容；不能只用一句泛化邀请替代原开场的具体介绍。只使用本通已有事实，不整段重播、不重复已听到的内容、不推进流程、不开始调查。", "The caller is only checking your identity or purpose, not expressing business interest. Answer that question directly, then naturally continue the relevant configured content still listed in openingContentStillUnheard. A generic invitation must not replace the unheard specifics. Use only this call's supplied facts. Do not replay the whole opening, repeat heard parts, advance the flow or start a survey. Speak English only."))
							} else if pausedRecording != "" && !unfinished {
								session.DiscardRecording()
								if !session.ResolveDirectReply(e.Text, e.Trace) {
									guideReply("客户打断了真人录音并提出了实际问题或明确答复。先理解并回应：有明确匹配的已审核录音则使用；否则检索知识库，以绑定的同一本人声音回答。只在必要时自然衔接未说明的来意，不从头重播录音，也不假定整条录音已经听完。")
								}
							} else if dialogue.resumeOpening() {
								// A greeting must not cancel the natural reply already
								// generating or waiting for its first synthesized audio.
								releaseReply()
								requested, err := session.EnsureReplyIfIdle(conversationLine(language, "客户只是在问候，开场介绍尚未完整听到。按通话状态只简短补齐尚未听到的身份或来意，征求现在是否方便，真正等待回答。已听到的部分不重复，不完整重读长开场，不跳到业务调查。", "The caller is only greeting you and the introduction was interrupted. Follow the call state to briefly add only the identity or purpose not yet heard. Ask whether this is a convenient time, then wait. Do not repeat parts already heard, replay the long opening or start a survey. Speak English only."))
								if err != nil {
									callLog.Warn("could not ensure opening continuation", "error", err)
								} else {
									dialogue.openingResumeUsed = requested
									callLog.Info("opening continuation preserves current reply", "requested", requested)
								}
							} else if unfinished {
								session.DiscardRecording()
								resumeAfterGreeting, resumeRecording = false, nil
								if holdReply() {
									listenAgain = time.After(1800 * time.Millisecond)
								}
							} else if !isOpeningReplay && session.ResolveDirectReply(e.Text, e.Trace) {
								heldReply = false
								listenAgain = nil
							} else if isOpeningReplay {
								guideReply(conversationLine(language, "固定开场白已完整播放。直接回答客户在播放期间提出的实际问题或诉求，结合本通真实上下文；不重播介绍，不把嗯、你好、喂等附和当作问题。若客户已明确拒绝或结束，礼貌告别。", "The fixed opening has finished. Answer the substantive questions or requests the caller raised while it played, using this call context. Do not repeat the introduction or answer greetings and fillers as questions. Respect an explicit refusal or request to end."))
							} else if heldReply {
								guideReply("结合客户刚才的续句和前文回应，不从被打断的业务问题重新开始。")
							}
						}
					}
					c.mu.Lock()
					if !isOpeningReplay && len(c.Transcript) < 500 {
						c.Transcript = append(c.Transcript, transcript{speaker, e.Text, time.Now().UTC().Format(time.RFC3339Nano)})
						if e.Type == aicall.EventTypeBotSaid {
							recordedBotTurns[e.Turn] = true
						}
					}
					c.mu.Unlock()
				}
				queueOpeningReply()
			case aicall.EventTypeDigit:
				if !c.Req.DemoCall && flow != nil && flow.current().Kind == "ivr" {
					result, _, node := flow.advance(e.Text, "")
					if node != nil {
						releaseReply()
						dialogue.fragment = ""
						a.recordFlow(c, node, e.Text)
						refreshDialogue()
						closing := node.Kind == "end" || node.Kind == "handoff"
						speech := node.Text
						if node.Kind == "handoff" {
							if target, e := a.reserveHandoff(ctx, id); e == nil {
								handoffTarget = target
								handoffTurn = session.CurrentTurn() + 1
								closing = false
								speech = c.Req.SystemSpeech.line(language, "handoffStart")
							}
						}
						if closing {
							armEnding(session.CurrentTurn() + 1)
							grace = time.After(15 * time.Second)
						}
						session.Speak(speech, closing)
					}
					_ = result
				}
			case aicall.EventTypeToolCall:
				// Even a pending spoken closing must be cut short for an assistant.
				if e.ToolName == "hangup_answering_assistant" {
					var args struct {
						Evidence string `json:"evidence"`
					}
					if json.Unmarshal([]byte(e.ToolArgs), &args) == nil && normalizeAssistantText(args.Evidence) != "" && strings.Contains(normalizeAssistantText(receivedForAssistant), normalizeAssistantText(args.Evidence)) {
						if detected := matchAssistantDetection(args.Evidence, c.Req.AssistantDetectionRules); detected != nil {
							stopMachine(args.Evidence, detected)
							return
						}
					}
					if !armed {
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"assistant_not_confirmed"}`, conversationLine(language, "尚无明确代接公告，先听对方说话；不要凭背景声或普通业务问题认定语音助手，不朗读此内部判断。", "No explicit answering-assistant announcement has been confirmed. Listen to the caller; do not infer an assistant from background sounds or ordinary questions, and do not read this internal judgment aloud."))
					}
					continue
				}
				if armed {
					if e.ToolName == "end_call" {
						logEndCallDecision(e.Turn, false, "already_armed")
					}
					continue
				}
				if c.Req.DemoCall {
					// The tool list is deliberately small, but validate again here so
					// stale or unsolicited tool calls cannot perform business actions.
					if e.ToolName != "end_call" {
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"demo_action_unavailable"}`, conversationLine(language, "这是隔离的电话演示，不检索外部知识、不转人工、不修改业务资料。请结合参考问答自然回答客户；资料没有说明的内容如实说尚未提供，不声称执行了任何操作。", "This is an isolated phone demo. Do not search external knowledge, transfer the call or update business data. Answer naturally from the reference Q&A; say when information is not provided and never claim an action was performed."))
						continue
					}
					if strings.TrimSpace(demoLastCustomer) == "" {
						logEndCallDecision(e.Turn, false, "no_customer_turn")
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"no_customer_turn"}`, conversationLine(language, "客户尚未发言，请等待，不要自行结束或重复开场。", "The caller has not spoken yet. Wait without ending the call or repeating the opening."))
						continue
					}
					armEnding(session.CurrentTurn() + 1)
					releaseReply()
					recognitionWait = nil
					grace = time.After(15 * time.Second)
					logEndCallDecision(e.Turn, true, "demo_conversation_ended")
					_ = session.AnswerTool(e.ToolCallID, `{"saved":true}`, conversationLine(language, "客户已经要求结束或交流自然结束，请用中文简短礼貌告别，然后结束本次演示。", "The caller asked to stop or the conversation has naturally concluded. Give one brief polite goodbye in English, then end this demo."))
					continue
				}
				if e.ToolName == "search_knowledge" {
					var args struct {
						Query string `json:"query"`
					}
					if armed || heldReply || knowledgeQueries >= 2 || knowledgeTotal >= 60 || json.Unmarshal([]byte(e.ToolArgs), &args) != nil {
						_ = session.AnswerTool(e.ToolCallID, knowledgeUnavailable, "当前不可继续查询，先听完客户的问题；不确定的业务事实交由人工核实，不要重复调用。")
						continue
					}
					knowledgeQueries++
					knowledgeTotal++
					queryStartedAt := time.Now()
					callLog.Info("voice phase", append(e.Trace.LogAttrs(), "phase", "knowledge_lookup_started", "stageAt", queryStartedAt.UTC(), "toolCallId", e.ToolCallID)...)
					result := a.lookupKnowledge(ctx, id, args.Query)
					callLog.Info("voice phase", append(e.Trace.LogAttrs(), "phase", "knowledge_lookup_finished", "stageAt", time.Now().UTC(), "toolCallId", e.ToolCallID, "durationMs", time.Since(queryStartedAt).Milliseconds(), "unavailable", result == knowledgeUnavailable)...)
					_ = session.AnswerTool(e.ToolCallID, result, "优先依据管理员已确认的当前业务事实，结合检索到的相关资料自然回答一两句；已确认的事实不要再说需核实。保留资料条件和有效期，不念资料编号。无相关结果时澄清一次或安排人工核实，不编造也不因此直接挂断。")
					continue
				}
				if e.ToolName == "advance_flow" {
					if dialogue.audioIssue {
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"audio_confirmation_pending"}`, dialogue.communicationHint())
						continue
					}
					if dialogue.followUpFocused {
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"follow_up_selected"}`, dialogue.followUpHint())
						continue
					}
					if heldReply {
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"customer_turn_incomplete"}`, "客户还在补充或需要澄清，保持当前节点；先听完，不推进也不重播问题。")
						continue
					}
					var args struct {
						Branch string `json:"branch"`
						Value  string `json:"value"`
					}
					if flow == nil || json.Unmarshal([]byte(e.ToolArgs), &args) != nil {
						session.AnswerTool(e.ToolCallID, `{"error":"flow_unavailable"}`, "继续按话术与客户沟通，不调用流程工具。")
						continue
					}
					if strings.TrimSpace(dialogue.lastCustomer) == "" || greetingAcknowledgement(dialogue.lastCustomer) || introductionQuestion(dialogue.lastCustomer, language) || (shortNegative(dialogue.lastCustomer) && flow.current().Kind == "opening") {
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"meaning_not_confirmed"}`, "客户仅问候、核实身份或来意，或短答含义尚未确定，保持当前节点；先回答当前问题并补齐未听到的必要介绍，不能当作业务同意、意向或拒绝。")
						continue
					}
					result, hint, node := flow.advance(args.Branch, args.Value)
					if node != nil {
						a.recordFlow(c, node, args.Branch)
						if args.Value != "" {
							c.mu.Lock()
							if c.Collected == nil {
								c.Collected = map[string]string{}
							}
							if field := flow.lastField; field != "" && len(args.Value) <= 1000 {
								c.Collected[field] = args.Value
							}
							c.mu.Unlock()
						}
						if node.Kind == "handoff" {
							if target, e := a.reserveHandoff(ctx, id); e == nil {
								handoffTarget = target
								handoffTurn = session.CurrentTurn() + 1
								hint = "只说一句：请稍等，我联系一下在岗同事。尚未接通，不能说已经转接。"
							}
						}
						if node.Kind == "end" || (node.Kind == "handoff" && handoffTarget == nil) {
							armEnding(session.CurrentTurn() + 1)
							grace = time.After(15 * time.Second)
						}
					}
					refreshDialogue()
					session.AnswerTool(e.ToolCallID, result, hint)
					continue
				}
				if e.ToolName == "end_call" || e.ToolName == "request_handoff" || e.ToolName == "mark_do_not_call" {
					if e.ToolName == "end_call" && dialogue.followUpOtherPending && conversationEnding(dialogue.lastCustomer, language) == "" && !dialogue.communicationExhausted() {
						logEndCallDecision(e.Turn, false, "wechat_contact_pending")
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"wechat_contact_pending"}`, dialogue.followUpHint())
						continue
					}
					if e.ToolName == "end_call" && followUpQuestion(dialogue.lastCustomer) && !politePersonalWeChatRequest(dialogue.lastCustomer) && !dialogue.communicationExhausted() {
						logEndCallDecision(e.Turn, false, "customer_question_pending")
						_ = session.AcknowledgeTool(e.ToolCallID, `{"saved":false,"error":"customer_question_pending"}`)
						continue
					}
					if e.ToolName == "end_call" && dialogue.communicationBlockedTurn == e.Turn {
						_ = session.AcknowledgeTool(e.ToolCallID, `{"saved":false,"error":"reply_not_grounded"}`)
						logEndCallDecision(e.Turn, false, "reply_not_grounded")
						continue
					}
					if e.ToolName == "end_call" && e.Turn <= followUpEndingState.cancelledThrough && conversationEnding(dialogue.lastCustomer, language) == "" && !dialogue.communicationExhausted() {
						logEndCallDecision(e.Turn, false, "customer_turn_changed")
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"customer_turn_changed"}`, "客户已继续发言，先理解并回应最新意思，不沿用被打断回复的结束动作；听音问题优先处理，不重复调查或确认。")
						continue
					}
					if e.ToolName == "end_call" && dialogue.audioIssue && !dialogue.communicationExhausted() && conversationEnding(dialogue.lastCustomer, language) == "" {
						logEndCallDecision(e.Turn, false, "audio_confirmation_pending")
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"audio_confirmation_pending"}`, dialogue.communicationHint())
						continue
					}
					if (e.ToolName == "mark_do_not_call" && conversationEnding(dialogue.lastCustomer, language) != "opt_out") || ((e.ToolName == "end_call" || e.ToolName == "mark_do_not_call") && !(e.ToolName == "end_call" && dialogue.communicationExhausted()) && (strings.TrimSpace(dialogue.lastCustomer) == "" || (dialogue.greeting(dialogue.lastCustomer) && !dialogue.followUpNumberConfirmed) || introductionQuestion(dialogue.lastCustomer, language) || shortNegative(dialogue.lastCustomer) || dialogue.fragment != "")) {
						if e.ToolName == "end_call" {
							logEndCallDecision(e.Turn, false, "no_explicit_ending")
						}
						_ = session.AnswerTool(e.ToolCallID, `{"saved":false,"error":"no_explicit_ending"}`, "客户没有明确要求结束，刚才是问候、身份或来意核实、业务短答复或未完句；先回应或澄清，不告别。")
						continue
					}
					if e.ToolName == "end_call" && dialogue.followUp == "wechat" && dialogue.followUpFocused && !dialogue.audioIssue && conversationEnding(dialogue.lastCustomer, language) == "" {
						// Return the result without generating another farewell.
						// Final text and playback can arrive on either side of the tool.
						if err := session.AcknowledgeTool(e.ToolCallID, `{"saved":true}`); err != nil {
							callLog.Warn("could not acknowledge follow-up ending", "error", err)
							continue
						}
						followUpEndingState.tool(e.Turn)
						logEndCallDecision(e.Turn, true, "follow_up_awaits_farewell_playback")
						if resolveFollowUpEnding() {
							return
						}
						continue
					}
					if e.ToolName == "mark_do_not_call" {
						c.mu.Lock()
						c.OptOut = true
						c.mu.Unlock()
					}
					if e.ToolName == "request_handoff" {
						c.mu.Lock()
						c.Handoff = true
						c.mu.Unlock()
					}
					if e.ToolName == "request_handoff" {
						target, reserveErr := a.reserveHandoff(ctx, id)
						if reserveErr == nil {
							handoffTarget = target
							handoffTurn = session.CurrentTurn() + 1
							releaseReply()
							session.AnswerTool(e.ToolCallID, `{"saved":true,"status":"seat_reserved"}`, "只说一句：请稍等，我联系一下在岗同事。尚未接通，不能说已经转接。")
							continue
						}
					}
					if e.ToolName == "end_call" || e.ToolName == "mark_do_not_call" {
						// A successful ending needs playback, not another model
						// inference requested by the tool acknowledgement.
						if err := session.AcknowledgeTool(e.ToolCallID, `{"saved":true}`); err != nil {
							callLog.Warn("could not acknowledge conversation ending", "error", err)
						}
						logEndCallDecision(e.Turn, true, "configured_farewell")
						closePolitely(c.Req.SystemSpeech.line(language, "goodbye"))
						continue
					}
					armEnding(session.CurrentTurn() + 1)
					releaseReply()
					grace = time.After(15 * time.Second)
					if e.ToolName == "end_call" {
						reason := "conversation_ended"
						if dialogue.communicationExhausted() {
							reason = "audio_repair_exhausted"
						}
						logEndCallDecision(e.Turn, true, reason)
					}
					hint := "请简短礼貌告别，然后本通话会结束。"
					if e.ToolName == "request_handoff" {
						hint = "告知会安排人工跟进，不要声称已经转接，然后礼貌告别。"
					}
					session.AnswerTool(e.ToolCallID, `{"saved":true}`, hint)
				} else {
					session.AnswerTool(e.ToolCallID, `{"error":"unsupported"}`, "请继续回答客户问题。")
				}
			case aicall.EventTypePlaybackDone:
				if _, pending := pendingBotTurns[e.Turn]; pending {
					delete(pendingBotTurns, e.Turn)
					if e.HasAudio {
						if dialogue.acceptBot(e.Turn) {
							refreshDialogue()
							if e.Turn > 0 && !recordedBotTurns[e.Turn] {
								c.mu.Lock()
								if len(c.Transcript) < 500 {
									c.Transcript = append(c.Transcript, transcript{"agent", dialogue.lastBotContext, time.Now().UTC().Format(time.RFC3339Nano)})
								}
								c.mu.Unlock()
								recordedBotTurns[e.Turn] = true
							}
						}
					} else {
						dialogue.rejectUnheardBot(e.Turn)
						unheardRejectedTurns[e.Turn] = true
						refreshDialogue()
					}
				}

				if handoffTarget != nil && e.HasAudio && e.Turn >= handoffTurn {
					target := handoffTarget
					handoffTarget = nil
					if a.transferHandoff(ctx, c, target) == nil {
						return
					}
					armEnding(session.CurrentTurn() + 1)
					grace = time.After(15 * time.Second)
					session.Speak(c.Req.SystemSpeech.line(language, "handoffUnavailable"), true)
					continue
				}
				if !c.Req.DemoCall && !armed && dialogue.openingPlaybackDone(e.Turn, e.RecordingKey, e.HasAudio) {
					refreshDialogue()
				}
				queueOpeningReply()
				followUpEndingState.playback(e.Turn, e.HasAudio)
				if followUpEndingState.pending > 0 || followUpEndingState.toolTurn > 0 {
					callLog.Info("follow-up closing playback observed", "turn", e.Turn, "hasAudio", e.HasAudio, "currentTurn", session.CurrentTurn(), "pendingTurn", followUpEndingState.pending, "callerSpeaking", callerSpeaking, "recognitionPending", recognitionWait != nil)
				}
				if resolveFollowUpEnding() {
					return
				}
				if armed && e.HasAudio && e.Turn >= closingTurn && session.ClosingPlaybackMatches(e.Turn) {
					callLog.Info("closing playback completed; hanging up", "turn", e.Turn, "closingTurn", closingTurn)
					d.Stop()
					return
				}
			case aicall.EventTypeNoInput:
				if session.ActiveRecording() != "" || !openingPending.empty() || openingReplayReady || armed || heldReply || callerSpeaking || recognitionWait != nil || time.Since(lastSilenceCue) < time.Second {
					continue
				}
				silencePrompt()
			case aicall.EventTypeFailed:
				c.mu.Lock()
				c.Failed = true
				c.mu.Unlock()
				d.Stop()
				return
			case aicall.EventTypeEnded:
				return
			}
		}
	}
}
func (a *app) finishSwitch(e *esl.Event, c *call, id string, employeeOnly bool) {
	c.mu.Lock()
	if c.Finished {
		c.mu.Unlock()
		return
	}
	c.Finished = true
	dialog := c.Dialog
	c.mu.Unlock()
	if dialog != nil {
		dialog.Stop()
	}
	time.Sleep(150 * time.Millisecond)
	c.mu.Lock()
	seconds, _ := strconv.Atoi(e.Get("variable_billsec"))
	cause := e.Get("Hangup-Cause")
	diagnostics := &switchDiagnostics{Leg: "CUSTOMER"}
	if employeeOnly {
		diagnostics.Leg = "EMPLOYEE"
	}
	// Persist only bounded protocol fields, never raw SIP headers or credentials.
	safeDiagnostic := regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)
	if safeDiagnostic.MatchString(cause) {
		diagnostics.Cause = cause
	}
	if disposition := e.Get("variable_sip_hangup_disposition"); safeDiagnostic.MatchString(disposition) {
		diagnostics.SIPDisposition = disposition
	}
	for _, key := range []string{"variable_sip_term_status", "variable_proto_specific_hangup_cause", "variable_sip_invite_failure_status", "variable_last_bridge_proto_specific_hangup_cause"} {
		status, err := strconv.Atoi(strings.TrimPrefix(e.Get(key), "sip:"))
		if err == nil && status >= 100 && status <= 699 {
			diagnostics.SIPStatus = status
			break
		}
	}
	slog.Info("switch call finished", "callId", id, "leg", diagnostics.Leg, "cause", diagnostics.Cause, "sipStatus", diagnostics.SIPStatus, "sipDisposition", diagnostics.SIPDisposition)
	state := "NOT_ANSWERED"
	if seconds > 0 || e.Get("Caller-Channel-Answered-Time") != "0" && e.Get("Caller-Channel-Answered-Time") != "" {
		state = "COMPLETED"
	}
	if employeeOnly {
		seconds = 0
		state = "NOT_ANSWERED"
		slog.Info("employee leg ended before customer bridge", "callId", id, "cause", cause)
		if cause == "" {
			cause = "EMPLOYEE_UNAVAILABLE"
		} else {
			cause = "EMPLOYEE_" + cause
		}
	}
	if c.Failed {
		state = "FAILED"
		cause = "VOICE_SERVICE_ERROR"
	}
	if c.EndReason != "" {
		cause = c.EndReason
	}
	ev := event{AnsweringMachineDetected: c.AssistantDetection != nil, AssistantDetection: c.AssistantDetection, Intent: c.Intent, IntentEvidence: c.IntentEvidence, MatchedRules: append([]intentRuleMatch{}, c.MatchedRules...), FlowTrace: append([]flowTrace{}, c.FlowTrace...), Collected: c.Collected, FlowOutcome: c.FlowOutcome, ID: uuid.NewString(), AttemptID: id, State: state, At: time.Now().UTC().Format(time.RFC3339Nano), Duration: seconds, Reason: cause, Transcript: append([]transcript{}, c.Transcript...), Handoff: c.Handoff, OptOut: c.OptOut, Diagnostics: diagnostics}
	if c.Model != nil {
		ev.ModelUsage = c.Model.UsageSnapshot()
	}
	if c.Req.Record {
		if st, err := os.Stat(filepath.Join(a.recordDir, id+".wav")); err == nil && st.Size() > 44 {
			ev.Recording = id + ".wav"
		}
	}
	c.mu.Unlock()
	a.rememberQuality(c, e, employeeOnly)
	a.persistEvent(ev)
	a.releaseReservation(c)
}
func (a *app) switchEvents(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case e, ok := <-a.link.Events():
			if !ok {
				return
			}
			id := e.Get("variable_taigua_attempt_id")
			parent := e.Get("variable_taigua_parent_id")
			if id == "" {
				id = parent
			}
			raw, found := a.calls.Load(id)
			if !found {
				continue
			}
			c := raw.(*call)
			if e.Get("Event-Name") == "CHANNEL_BRIDGE" {
				if c.Req.Mode == "MANUAL" && parent == "" {
					a.emit(id, "CONNECTED", "")
				}
				continue
			}
			if e.Get("Event-Name") != "CHANNEL_HANGUP_COMPLETE" {
				continue
			}
			if c.Req.Mode == "MANUAL" && parent != "" {
				// Do not block the switch event reader: the customer result must win.
				go func(ev *esl.Event, current *call, callID string) {
					time.Sleep(time.Second)
					if _, ok := a.calls.Load(callID); !ok {
						return
					}
					exists, err := a.link.API("uuid_exists " + current.CustomerID)
					if err != nil || strings.TrimSpace(exists) == "true" {
						return
					}
					a.finishSwitch(ev, current, callID, true)
				}(e, c, id)
			} else {
				go a.finishSwitch(e, c, id, false)
			}
		}
	}
}
// 中文注释：处理应用传入的通话控制请求。
func (a *app) control(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/control/")
	if _, err := uuid.Parse(id); err != nil {
		http.Error(w, "invalid call", 400)
		return
	}
	raw, ok := a.calls.Load(id)
	if !ok {
		http.Error(w, "call unavailable", 409)
		return
	}
	c := raw.(*call)
	var data struct {
		Action string `json:"action"`
		Digit  string `json:"digit"`
	}
	if r.Method != "POST" || json.NewDecoder(io.LimitReader(r.Body, 512)).Decode(&data) != nil {
		http.Error(w, "invalid control", 400)
		return
	}
	command := ""
	if data.Action == "hangup" {
		command = "uuid_kill " + id + " NORMAL_CLEARING"
	} else if data.Action == "dtmf" && c.Req.Mode == "MANUAL" && regexp.MustCompile(`^[0-9*#]$`).MatchString(data.Digit) {
		command = "uuid_send_dtmf " + c.CustomerID + " " + data.Digit
	} else {
		http.Error(w, "unsupported control", 400)
		return
	}
	result, err := a.link.API(command)
	if err != nil || !strings.HasPrefix(strings.TrimSpace(result), "+OK") {
		http.Error(w, "control not confirmed", 409)
		return
	}
	sendJSON(w, map[string]bool{"accepted": true})
}
// 中文注释：初始化语音桥依赖、SIP 与管理接口，并进入服务生命周期。
func main() {
	token := os.Getenv("SIP_BRIDGE_TOKEN")
	if len(token) < 32 {
		slog.Error("SIP_BRIDGE_TOKEN must be configured before starting")
		os.Exit(1)
	}
	profile := provider.QwenProfile()
	profile.APIKeyEnv = "DASHSCOPE_API_KEY"
	profile.Model = env("SIP_REALTIME_MODEL", profile.Model)
	maxCalls, limitErr := strconv.Atoi(env("SIP_MAX_CALLS", "0"))
	if limitErr != nil || maxCalls < 0 {
		slog.Error("SIP_MAX_CALLS must be a nonnegative integer; 0 leaves the quota unlimited")
		os.Exit(1)
	}
	a := &app{token: token, stateDir: env("SIP_STATE_DIR", "./state"), recordDir: env("SIP_RECORDING_DIR", "./recordings"), callback: env("SIP_CALLBACK_URL", "http://127.0.0.1:8510/api/v1/telephony/events"), profile: profile, live: os.Getenv("SIP_LIVE_ENABLED") == "true", max: maxCalls}
	if !regexp.MustCompile(`^http://127\.0\.0\.1:[0-9]+/api/v1/telephony/events$`).MatchString(a.callback) {
		slog.Error("callback must target the existing loopback API")
		os.Exit(1)
	}
	for _, dir := range []string{filepath.Join(a.stateDir, "events"), filepath.Join(a.stateDir, "requests"), filepath.Join(a.stateDir, "handoffs"), a.recordDir} {
		if os.MkdirAll(dir, 0700) != nil {
			os.Exit(1)
		}
	}
	a.link = esl.NewLink(env("SIP_ESL_ADDR", "127.0.0.1:18021"), os.Getenv("SIP_ESL_PASSWORD"), []string{"CHANNEL_HANGUP_COMPLETE", "CHANNEL_BRIDGE"})
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go a.link.Run(ctx)
	go a.flush(ctx)
	go a.switchEvents(ctx)
	go a.reconcileFailedReservations(ctx)
	cfg := voice.DefaultConfig()
	cfg.SIPHost = "127.0.0.1"
	cfg.SIPPort = 6060
	cfg.AdvertiseIP = "127.0.0.1"
	cfg.AllowedPeers = []netip.Prefix{netip.MustParsePrefix("127.0.0.0/8")}
	cfg.MaxCalls = maxCalls
	// Use the normal RTP resource pool; business quotas are configured by the system administrator.
	a.uas = voice.NewUAS(cfg)
	a.uas.OnCallStarted = func(d *voice.Dialog) { go a.onCall(d) }
	if err := a.uas.Start(); err != nil {
		slog.Error("cannot bind SIP listener")
		os.Exit(1)
	}
	defer a.uas.Stop()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", a.authorize(func(w http.ResponseWriter, r *http.Request) {
		key, err := credentialEnvironment(r.URL.Query().Get("scope"), modelKeyName(r.URL.Query().Get("model")))
		result := map[string]any{"switchReady": a.link.IsUp(), "externalReady": a.externalReady(), "executionEnabled": a.live, "modelConfigured": err == nil && os.Getenv(key) != "", "model": profile.Model, "voice": profile.Voice, "activeCalls": a.pending.Load()}
		if sourceVoice := r.URL.Query().Get("voice"); sourceVoice != "" {
			binding, bindingErr := provider.ConfiguredSpeechSynthesis(r.URL.Query().Get("scope"), r.URL.Query().Get("model"), sourceVoice)
			if bindingErr != nil {
				http.Error(w, "voice synthesis configuration unavailable", 503)
				return
			}
			if binding != nil {
				result["speechSynthesis"] = map[string]any{"model": binding.Model, "voiceId": binding.VoiceID, "voice": binding.Voice, "rate": binding.Rate, "pitch": binding.Pitch, "volume": binding.Volume}
			}
		}
		sendJSON(w, result)
	}))
	mux.HandleFunc("/control/", a.authorize(a.control))
	mux.HandleFunc("/status/", a.authorize(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/status/")
		if _, err := uuid.Parse(id); err != nil {
			http.NotFound(w, r)
			return
		}
		if !a.link.IsUp() {
			http.Error(w, "switch unavailable", 503)
			return
		}
		result, err := a.link.API("uuid_exists " + id)
		if err != nil {
			http.Error(w, "status unavailable", 503)
			return
		}
		body, fileErr := os.ReadFile(filepath.Join(a.stateDir, "requests", id+".json"))
		var saved request
		if fileErr == nil {
			if json.Unmarshal(body, &saved) != nil {
				http.Error(w, "saved status unavailable", 503)
				return
			}
			if saved.CustomerID != "" {
				if _, err := uuid.Parse(saved.CustomerID); err != nil {
					http.Error(w, "saved status unavailable", 503)
					return
				}
				secondary, err := a.link.API("uuid_exists " + saved.CustomerID)
				if err != nil {
					http.Error(w, "status unavailable", 503)
					return
				}
				if strings.TrimSpace(secondary) == "true" {
					result = "true"
				}
			}
		} else if !os.IsNotExist(fileErr) {
			http.Error(w, "saved status unavailable", 503)
			return
		}
		sendJSON(w, map[string]bool{"active": strings.TrimSpace(result) == "true", "known": fileErr == nil})
	}))
	mux.HandleFunc("/calls", a.authorize(a.originate))
	mux.HandleFunc("/operations", a.authorize(a.operations))
	mux.HandleFunc("/recordings/", a.authorize(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/recordings/")
		if _, err := uuid.Parse(id); err != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(a.recordDir, id+".wav"))
	}))
	server := &http.Server{Addr: "127.0.0.1:8511", Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	slog.Info("voice bridge started", "liveEnabled", a.live, "maxCalls", a.max)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, "voice service stopped")
		os.Exit(1)
	}
}
