// 中文导读：共享基础能力：operations.go。供 SIP 语音桥中的相关模块调用。
package main

import (
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"

	"taigua/sip-bridge/internal/aicall"
	"taigua/sip-bridge/internal/esl"
	"taigua/sip-bridge/internal/voice"
)

const qualityRetention = 15 * time.Minute
const qualityLimit = 50

var workspaceIdentifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// A zero setting must omit the variable: FreeSWITCH treats an explicit zero
// as a request to use its default jitter buffer. Only a new customer leg
// receives the administrator's override. The maximum bounds extra delay.
func networkJitterVariables(v request) string {
	if v.Audio == nil || v.Audio.NetworkJitterMs == 0 {
		return ""
	}
	ms := v.Audio.NetworkJitterMs
	return ",jitterbuffer_msec=" + strconv.Itoa(ms) + ":" + strconv.Itoa(ms*2) + ",rtp_jitter_buffer_during_bridge=true"
}

type localRTPQuality struct {
	voice.RTPMetrics
	RemoteLossPercent *float64 `json:"remoteLossPercent"`
	RemoteJitterMs    *float64 `json:"remoteJitterMs"`
}

// These values belong to the customer-facing FreeSWITCH channel. They are
// available only after its existing CHANNEL_HANGUP_COMPLETE event, and are
// independent from RTP counters on the loopback bridge leg.
type publicRTPQuality struct {
	ReceivedPackets     *float64 `json:"receivedPackets"`
	SentPackets         *float64 `json:"sentPackets"`
	JitterBufferPackets *float64 `json:"jitterBufferPackets"`
	SkipPackets         *float64 `json:"skipPackets"`
	FlawCount           *float64 `json:"flawCount"`
	MOS                 *float64 `json:"mos"`
}

type callQuality struct {
	AttemptID       string                      `json:"attemptId"`
	StartedAt       time.Time                   `json:"startedAt"`
	EndedAt         *time.Time                  `json:"endedAt,omitempty"`
	NetworkJitterMs int                         `json:"networkJitterMs"`
	LocalRTP        *localRTPQuality            `json:"localRtp"`
	PublicRTP       *publicRTPQuality           `json:"publicRtp"`
	TurnLatency     *aicall.TurnLatencySnapshot `json:"turnLatency"`
}

type storedCallQuality struct {
	workspaceID string
	quality     callQuality
}

// Do not hold call.mu while reading session or dialog locks: the media path
// may acquire them in the opposite order. Request data and Started are fixed
// at originate time; only pointers and Finished require the call lock.
func snapshotQuality(c *call) callQuality {
	c.mu.Lock()
	dialog, session := c.Dialog, c.Session
	c.mu.Unlock()
	q := callQuality{AttemptID: c.Req.ID, StartedAt: c.Started.UTC()}
	if c.Req.Audio != nil {
		q.NetworkJitterMs = c.Req.Audio.NetworkJitterMs
	}
	if dialog != nil && dialog.RTP != nil {
		q.LocalRTP = &localRTPQuality{RTPMetrics: dialog.RTP.Metrics()}
		remote := dialog.Quality()
		if !remote.At.IsZero() {
			loss, jitter := float64(remote.FractionLost)*100/256, float64(remote.Jitter)/8
			q.LocalRTP.RemoteLossPercent, q.LocalRTP.RemoteJitterMs = &loss, &jitter
		}
	}
	if session != nil {
		q.TurnLatency = session.TurnLatency()
	}
	return q
}

// Only known, finite, nonnegative numeric fields can leave the bridge. Never
// expose raw event headers (which include SIP credentials and phone numbers).
func eventMetric(e *esl.Event, key string, maxValue float64) *float64 {
	value, err := strconv.ParseFloat(e.Get("variable_"+key), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > maxValue {
		return nil
	}
	return &value
}

func publicQuality(e *esl.Event, c *call, employeeOnly bool) *publicRTPQuality {
	expected := c.Req.ID
	if c.Req.Mode == "MANUAL" {
		expected = c.CustomerID
	}
	// Matching the real customer UUID prevents an employee or local bot leg
	// from being mislabelled as the public network's media quality.
	if employeeOnly || expected == "" || e.Get("Unique-ID") != expected {
		return nil
	}
	q := &publicRTPQuality{
		ReceivedPackets:     eventMetric(e, "rtp_audio_in_packet_count", 1e12),
		SentPackets:         eventMetric(e, "rtp_audio_out_packet_count", 1e12),
		JitterBufferPackets: eventMetric(e, "rtp_audio_in_jitter_packet_count", 1e12),
		SkipPackets:         eventMetric(e, "rtp_audio_in_skip_packet_count", 1e12),
		FlawCount:           eventMetric(e, "rtp_audio_in_flaw_total", 1e12),
		MOS:                 eventMetric(e, "rtp_audio_in_mos", 5),
	}
	// A zero/default MOS is not a scored call. Packet counters can correctly
	// be zero; a MOS outside its scoring range is unknown instead.
	if q.MOS != nil && *q.MOS < 1 {
		q.MOS = nil
	}
	if q.ReceivedPackets == nil && q.SentPackets == nil && q.JitterBufferPackets == nil && q.SkipPackets == nil && q.FlawCount == nil && q.MOS == nil {
		return nil
	}
	return q
}

func (a *app) pruneQualityLocked(now time.Time) {
	kept := a.recentQuality[:0]
	for _, row := range a.recentQuality {
		if row.quality.EndedAt != nil && now.Sub(*row.quality.EndedAt) <= qualityRetention {
			kept = append(kept, row)
		}
	}
	// Clear pruned references too; otherwise the backing array retains them.
	clear(a.recentQuality[len(kept):])
	a.recentQuality = kept
}

func (a *app) rememberQuality(c *call, e *esl.Event, employeeOnly bool) {
	if !workspaceIdentifier.MatchString(c.Req.WorkspaceID) {
		return // Legacy unscoped requests must never enter a workspace view.
	}
	now := time.Now().UTC()
	q := snapshotQuality(c)
	q.EndedAt, q.PublicRTP = &now, publicQuality(e, c, employeeOnly)
	a.operationsMu.Lock()
	defer a.operationsMu.Unlock()
	a.pruneQualityLocked(now)
	if len(a.recentQuality) == qualityLimit {
		copy(a.recentQuality, a.recentQuality[1:])
		a.recentQuality = a.recentQuality[:qualityLimit-1]
	}
	a.recentQuality = append(a.recentQuality, storedCallQuality{workspaceID: c.Req.WorkspaceID, quality: q})
}

func (a *app) operations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	workspaceID := r.URL.Query().Get("workspaceId")
	if !workspaceIdentifier.MatchString(workspaceID) {
		http.Error(w, "workspaceId is required", http.StatusBadRequest)
		return
	}
	now := time.Now().UTC()
	active, recent := []callQuality{}, []callQuality{}
	a.calls.Range(func(_, value any) bool {
		c := value.(*call)
		if c.Req.WorkspaceID != workspaceID {
			return true
		}
		c.mu.Lock()
		finished := c.Finished
		c.mu.Unlock()
		if !finished {
			active = append(active, snapshotQuality(c))
		}
		return true
	})
	sort.Slice(active, func(i, j int) bool { return active[i].StartedAt.After(active[j].StartedAt) })
	if len(active) > qualityLimit {
		active = active[:qualityLimit]
	}
	a.operationsMu.Lock()
	a.pruneQualityLocked(now)
	for i := len(a.recentQuality) - 1; i >= 0; i-- {
		if row := a.recentQuality[i]; row.workspaceID == workspaceID {
			recent = append(recent, row.quality)
		}
	}
	a.operationsMu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	sendJSON(w, map[string]any{"version": 1, "observedAt": now, "retentionSeconds": int(qualityRetention.Seconds()), "limit": qualityLimit, "scope": "workspace", "localScope": "freeswitch_bridge", "publicScope": "freeswitch_external_hangup", "active": active, "recent": recent})
}
