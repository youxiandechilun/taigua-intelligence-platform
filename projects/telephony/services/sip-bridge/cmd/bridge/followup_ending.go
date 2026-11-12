// 中文导读：微信跟进后的结束状态；需核对轮次、播放完成与客户说话状态，再决定告别或挂断。
// 工具确认只表示业务动作被记录，不能据此额外要求模型再答一遍。
// 结束语尚未真正播放或客户仍在说话时继续等待；取消轮次的旧回调不能触发挂断。
package main

// Follow-up closing stays interruptible until the exact farewell has played.
// A tool acknowledgement never requests a second model response.
type followUpEnding struct {
	pending, cancelledThrough, toolTurn, playedTurn int
	playedAudio, requested                          bool
}

// 中文注释：记住满足微信跟进收尾条件的最终回复；是否可挂断留给后续状态判断。
// A valid final reply must be remembered even if the provider's speech-stop
// event trails it. Readiness belongs to resolve, never to this observation.
func (f *followUpEnding) observeReply(d *dialogueRuntime, review botReplyReview) bool {
	if !review.Closing || d.followUp != "wechat" || !d.followUpFocused || d.followUpOtherPending || d.audioIssue || d.fragment != "" || conversationEnding(d.lastCustomer, d.language) != "" || !(conversationFarewell(d.stream, d.language) || d.followUpCompleted()) {
		return false
	}
	f.final(review.Turn)
	return true
}

// 中文注释：结合客户说话、识别等待和当前回复状态，计算本轮收尾动作。
func (f *followUpEnding) resolve(d *dialogueRuntime, current int, armed, callerSpeaking, recognitionPending bool) int {
	eligible := !armed && !callerSpeaking && !recognitionPending && d.followUp == "wechat" && d.followUpFocused && !d.followUpOtherPending && !d.audioIssue && d.fragment == "" && conversationEnding(d.lastCustomer, d.language) == ""
	return f.action(current, eligible, d.streamTurn == current && terminalFarewell(d.stream))
}

// 中文注释：记录已取消的轮次上界，防止旧回调再次触发结束。
func (f *followUpEnding) cancel(turn int) {
	f.cancelledThrough = max(f.cancelledThrough, turn, f.pending, f.toolTurn)
	f.pending, f.toolTurn, f.requested = 0, 0, false
}
func (f *followUpEnding) final(turn int) {
	if turn > f.cancelledThrough {
		f.pending = turn
	}
}
func (f *followUpEnding) tool(turn int) {
	if turn > f.cancelledThrough {
		f.toolTurn = turn
	}
}
// 中文注释：记录已播放轮次及是否产生音频，供收尾状态机核对。
func (f *followUpEnding) playback(turn int, audio bool) {
	if turn >= f.playedTurn {
		f.playedTurn, f.playedAudio = turn, audio
	}
}

// 中文注释：返回动作编号：0 等待、1 挂断、2 补短告别、3 处理仅工具触发的跟进收尾。
// 0: wait, 1: hang up, 2: say a short goodbye, 3: tool-only follow-up closing.
func (f *followUpEnding) action(current int, eligible, farewell bool) int {
	if !eligible || current <= f.cancelledThrough || current != f.playedTurn {
		return 0
	}
	if f.pending == current && f.playedAudio {
		if farewell {
			return 1
		}
		if !f.requested {
			return 2
		}
	}
	if f.toolTurn == current && f.pending == 0 && !f.playedAudio && !f.requested {
		return 3
	}
	return 0
}
func silenceCheckLine(language string, count int) string {
	if count >= 2 {
		return conversationLine(language, "请问您还在听吗？", "Are you still there?")
	}
	return conversationLine(language, "您还有什么想了解的吗？", "Is there anything else you'd like to know?")
}
