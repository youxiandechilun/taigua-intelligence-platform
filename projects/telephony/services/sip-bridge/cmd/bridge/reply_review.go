// 中文导读：对模型回复进行业务检查，并决定是否修正、放行或结束。
package main

// botReplyReview keeps one decision for a model event. Draft observation,
// review, and context submission have separate responsibilities: a rejected
// unvoiced draft cannot become a question the customer supposedly heard.
type botReplyReview struct {
	Turn                int
	Ignored             bool
	Repeated            bool
	Premature           bool
	UnneededSurvey      bool
	CommunicationRepair bool
	CommunicationReason string
	Closing             bool
	Intercepted         bool
	GuidanceOnly        bool
	RecoveryHint        string
}

func reviewBotReply(d *dialogueRuntime, text string, final bool, turn int) botReplyReview {
	r := botReplyReview{Turn: turn}
	if d.ignoreBotTurn(turn) {
		r.Ignored = true
		return r
	}
	r.Repeated = d.bot(text, final, turn)
	r.Premature = d.prematureClosing()
	r.UnneededSurvey = d.unneededSurveyQuestion()
	r.CommunicationRepair = d.communicationRepair()
	if r.CommunicationRepair {
		r.CommunicationReason = d.communicationBlockReason
	}
	r.Closing = final && !r.Premature && !r.CommunicationRepair && (conversationFarewell(text, d.language) || d.followUpCompleted())
	// Streaming text is only an observation.  Permanent rejection is safe
	// after the provider's final event, otherwise an early fragment can match
	// a guard and prevent the same turn's final answer from being delivered.
	// Repetition and extra survey questions are guidance, not reasons to
	// discard a usable reply and run LLM/TTS a second time. Keep protection
	// for unfinished customer/contact speech, audio issues and rule coaching.
	r.Intercepted = final && !r.Closing && (r.Premature || r.CommunicationRepair)
	r.GuidanceOnly = final && !r.Closing && !r.Intercepted && (r.Repeated || r.UnneededSurvey)
	if !r.Intercepted && !r.GuidanceOnly {
		return r
	}
	// Compute the direction from this rejected candidate before discarding it.
	r.RecoveryHint = "刚才准备的回答重复了已经问过的问题，已被系统打断。不要复述或改写该问题来追问。重新理解最近客户的完整意思：反问先答，纠正先采纳，话没说完先让他说；不知道就针对缺失部分澄清一次。只自然回应一两句，然后等待。"
	if r.Premature {
		r.RecoveryHint = "客户没有要求结束。刚才是问候、没有/不是等业务短答复或尚未识别清楚。先回应最新意思或简短澄清，开场未完整时补齐身份与来意，不告别、不猜测客户没空。"
	}
	if d.followUpFocused {
		r.RecoveryHint = d.followUpHint()
	}
	if r.CommunicationRepair || d.audioIssue {
		r.RecoveryHint = d.communicationHint()
	}
	return r
}

// resolveBotReply is called after playback has been held for an intercepted
// reply, so audio queued during review is retained conservatively. Queued
// audio is evidence of possible partial delivery, never of complete playback.
func resolveBotReply(d *dialogueRuntime, r botReplyReview, mayHaveAudio bool) bool {
	if r.Ignored {
		return false
	}
	if r.Intercepted {
		if !mayHaveAudio {
			d.rejectUnheardBot(r.Turn)
			return false
		}
		// A response with some queued audio may have been partly heard. Keep
		// only that turn as conversational context; it was interrupted and
		// must not become a complete history entry or a completed question.
		d.preserveBotContext(r.Turn)
		return false
	}
	return d.acceptBot(r.Turn)
}
