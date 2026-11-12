// SPDX-License-Identifier: Apache-2.0
// Taigua adaptation: extracted for the existing workspace-scoped sales system.
// Local metrics adapter: the extracted packages no longer require a second
// application database or observability service.
// 中文导读：运行指标：counters.go。供 SIP 语音桥中的相关模块调用。
package obs

import (
	"github.com/google/uuid"
	"log/slog"
	"sync/atomic"
	"time"
)

const (
	BotSlotInUse    = "in_use"
	BotSlotReserved = "reserved"
)

var inUse, reserved atomic.Int64

func BotSlotsChanged(kind string, delta int) {
	if kind == BotSlotInUse {
		inUse.Add(int64(delta))
	} else {
		reserved.Add(int64(delta))
	}
}
func RecordBotFirstMedia(ms int64) { slog.Debug("first media", "ms", ms) }
func OutboundFirstAudio(id uuid.UUID, at time.Time) {
	slog.Debug("first audio", "callId", id, "at", at)
}
func RecordBotFirstAudio(provider string, ms int64, beforeMedia bool) {
	slog.Debug("first model audio", "provider", provider, "ms", ms, "beforeMedia", beforeMedia)
}
func RecordProviderError(provider string) { slog.Warn("voice provider error", "provider", provider) }
func RecordProviderSessionExpired(provider string) {
	slog.Warn("voice session expired", "provider", provider)
}
func RecordBotInterruption(reason string) { slog.Debug("voice interrupted", "reason", reason) }
func RecordTurnLatency(provider string, ms int64) {
	slog.Debug("turn latency", "provider", provider, "ms", ms)
}
func RecordProviderFirstAudio(provider string, ms int64) {
	slog.Debug("provider latency", "provider", provider, "ms", ms)
}
