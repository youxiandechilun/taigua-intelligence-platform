// 中文导读：把客户完整问句与已配置问法匹配；唯一命中才直播放音，未命中或音频不可用时回退模型。
// 匹配来自当前通话配置的完整问句和相似问法；不按猜测的语义强行选择录音。
// 读取音频前后检查客户轮次及取消代次；被新一句话替代的旧请求不能继续出声。
// 未命中、多个结果冲突或音频读取失败时，使用正常模型回答路径。
package provider

import (
	"context"
	"strings"
	"taigua/sip-bridge/internal/media"
	"time"
	"unicode"
)

// 中文注释：仅保留字母和数字并统一大小写，消除问句标点差异。
// Only configured complete questions and visible aliases may select a clip.
// Punctuation/case differences are harmless; guessing an intent is not.
func directQuestion(text string) string {
	return strings.Map(func(c rune) rune {
		if unicode.IsLetter(c) || unicode.IsDigit(c) {
			return unicode.ToLower(c)
		}
		return -1
	}, strings.TrimSpace(text))
}
// 中文注释：只匹配页面配置的完整问句和相似问法；多项冲突、未就绪和未命中均返回原因。
func matchDirectRecording(text string, clips []Recording) (*Recording, string) {
	q := directQuestion(text)
	if len([]rune(q)) < 2 {
		return nil, "no_match"
	}
	matched := map[string]Recording{}
	for _, clip := range clips {
		if !clip.Direct {
			continue
		}
		for _, phrase := range append([]string{clip.Trigger}, clip.Phrases...) {
			if q == directQuestion(phrase) {
				matched[clip.Key] = clip
				break
			}
		}
	}
	if len(matched) > 1 {
		return nil, "ambiguous"
	}
	for _, clip := range matched {
		if clip.AssetID == "" || len(clip.SHA256) != 64 {
			return nil, "not_ready"
		}
		return &clip, "matched"
	}
	return nil, "no_match"
}

func (r *Recorded) directFloor(trace ResponseTrace) (current, speaking bool) {
	r.Realtime.mu.Lock()
	defer r.Realtime.mu.Unlock()
	return r.Realtime.manualReplies && !r.isLocallyClosed.Load() && trace.CustomerTurn != 0 && trace.CustomerTurn == r.timing.customerSequence, r.isCallerSpeaking
}
func (r *Recorded) directCurrent(trace ResponseTrace, epoch uint64) bool {
	current, speaking := r.directFloor(trace)
	r.mu.Lock()
	defer r.mu.Unlock()
	return current && !speaking && !r.stopped && r.directEpoch == epoch
}

// 中文注释：先确认客户轮次有效且已停话，再尝试直播放音；音频失败或未命中会转入模型回复。
// ResolveDirectReply is called by the application AFTER its opening, opt-out,
// accepted-invitation and unfinished-speech rules. No model request precedes it.
func (r *Recorded) ResolveDirectReply(text string, trace ResponseTrace) bool {
	current, _ := r.directFloor(trace)
	if !current {
		return false
	}
	r.startMu.Lock()
	r.mu.Lock()
	if r.stopped {
		r.mu.Unlock()
		r.startMu.Unlock()
		return true
	}
	if r.directTurn == trace.CustomerTurn {
		r.mu.Unlock()
		r.startMu.Unlock()
		return true
	}
	r.directTurn = trace.CustomerTurn
	r.directEpoch++
	epoch := r.directEpoch
	r.writers.Add(1)
	r.mu.Unlock()
	r.startMu.Unlock()
	go func() {
		defer r.writers.Done()
		// Some ASR finals precede speech_stopped. Never answer into that speech.
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			current, speaking := r.directFloor(trace)
			if !current {
				return
			}
			if !speaking {
				break
			}
			select {
			case <-r.ctx.Done():
				return
			case <-ticker.C:
			}
		}
		if !r.directCurrent(trace, epoch) {
			return
		}
		clip, reason := matchDirectRecording(text, r.clips)
		started := time.Now()
		if clip == nil {
			r.directFallback(trace, epoch, reason)
			return
		}
		ctx, cancel := context.WithTimeout(r.ctx, 700*time.Millisecond)
		pcm, err := r.audio(ctx, *clip)
		cancel()
		if err != nil {
			r.log.Warn("direct recording unavailable; using model", "key", clip.Key, "customerTurn", trace.CustomerTurn, "readMs", time.Since(started).Milliseconds(), "error", err)
			r.directFallback(trace, epoch, "audio_unavailable")
			return
		}
		// Validate the output path before holding the model or announcing playback.
		if _, err := media.NewConverter(media.PCM16Format(8000), r.format); err != nil {
			r.directFallback(trace, epoch, "output_format")
			return
		}
		r.startMu.Lock()
		defer r.startMu.Unlock()
		if !r.directCurrent(trace, epoch) {
			return
		}
		r.mu.Lock()
		r.modelHeld = false
		r.mu.Unlock()
		clip.customerTurn = trace.CustomerTurn
		r.log.Info("direct recording matched", "key", clip.Key, "assetId", clip.AssetID, "customerTurn", trace.CustomerTurn, "readMs", time.Since(started).Milliseconds(), "modelRequested", false)
		r.launchPlaybackLocked(*clip, pcm, "", 0, 0)
	}()
	return true
}

// 中文注释：仅对仍有效的轮次释放录音路径并请求模型回答，避免旧请求穿透新轮次。
func (r *Recorded) directFallback(trace ResponseTrace, epoch uint64, reason string) {
	r.startMu.Lock()
	defer r.startMu.Unlock()
	if !r.directCurrent(trace, epoch) {
		return
	}
	r.cancelPlayback(true)
	r.mu.Lock()
	r.active = nil
	r.modelHeld = false
	r.mu.Unlock()
	requested, err := r.Realtime.requestDirectedReplyFor(&trace, "依据客户刚才的问题和本通已确认资料简短自然回答。", false, true)
	r.log.Info("direct recording fallback", "reason", reason, "customerTurn", trace.CustomerTurn, "modelRequested", requested, "error", err)
}
