// 中文导读：模型与语音供应商适配：usage.go。供 SIP 语音桥中的相关模块调用。
package provider

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// Each snapshot is cumulative for this call. Consumers upsert by call id;
// event retries, interruptions and heartbeats never multiply billed tokens.
type UsageSnapshot struct {
	InputTokens       *int   `json:"inputTokens,omitempty"`
	OutputTokens      *int   `json:"outputTokens,omitempty"`
	TotalTokens       *int   `json:"totalTokens,omitempty"`
	InputAudioTokens  *int   `json:"inputAudioTokens,omitempty"`
	OutputAudioTokens *int   `json:"outputAudioTokens,omitempty"`
	CachedTokens      *int   `json:"cachedTokens,omitempty"`
	Requests          int    `json:"requests"`
	MissingUsage      int    `json:"missingUsage"`
	KeyFingerprint    string `json:"keyFingerprint"`
	Connected         *bool  `json:"connected,omitempty"`
	ObservedAt        string `json:"observedAt,omitempty"`
}

func addCounter(dst **int, v int) {
	if v < 0 || v > 1e12 {
		return
	}
	n := v
	if *dst != nil {
		n += **dst
	}
	*dst = &n
}
func (r *Realtime) observeConnection(connected bool) {
	r.usageMu.Lock()
	defer r.usageMu.Unlock()
	r.usage.Connected = &connected
	r.usage.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
}
func (r *Realtime) observeUsage(response *wireResponse) {
	if response == nil {
		return
	}
	r.usageMu.Lock()
	defer r.usageMu.Unlock()
	if r.usageSeen == nil {
		r.usageSeen = map[string]struct{}{}
	}
	if response.ID != "" {
		if _, seen := r.usageSeen[response.ID]; seen {
			return
		}
		r.usageSeen[response.ID] = struct{}{}
	}
	r.usage.Requests++
	u := response.Usage
	if u == nil || !u.reported || u.InputTokens > 1e12 || u.OutputTokens > 1e12 || u.TotalTokens > 1e12 {
		r.usage.MissingUsage++
		return
	}
	if u.inputReported {
		addCounter(&r.usage.InputTokens, u.InputTokens)
	}
	if u.outputReported {
		addCounter(&r.usage.OutputTokens, u.OutputTokens)
	}
	addCounter(&r.usage.TotalTokens, u.TotalTokens)
	if u.InputDetails != nil {
		if u.InputDetails.AudioTokens != nil {
			addCounter(&r.usage.InputAudioTokens, *u.InputDetails.AudioTokens)
		}
		if u.InputDetails.CachedTokens != nil {
			addCounter(&r.usage.CachedTokens, *u.InputDetails.CachedTokens)
		}
	}
	if u.OutputDetails != nil && u.OutputDetails.AudioTokens != nil {
		addCounter(&r.usage.OutputAudioTokens, *u.OutputDetails.AudioTokens)
	}
}
func (r *Realtime) UsageSnapshot() *UsageSnapshot {
	r.usageMu.Lock()
	defer r.usageMu.Unlock()
	snapshot := r.usage
	sum := sha256.Sum256([]byte(r.apiKey))
	snapshot.KeyFingerprint = hex.EncodeToString(sum[:])
	return &snapshot
}
