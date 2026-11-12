// 中文导读：客户接受邀约后的业务收尾判断。
package main

import "strings"

// acceptedFollowUpInvitation interprets a complete answer against the adjacent
// invitation. It does not invent a workspace intent rule or a contact action.
func acceptedFollowUpInvitation(answer, previous string) bool {
	return followUpInvitationContext(previous) && acceptedBusinessInvitation(answer, previous)
}

func acceptedBusinessInvitation(answer, previous string) bool {
	if !(followUpInvitationContext(previous) || intentBusinessInvitation(previous)) || strings.ContainsAny(answer, "\"“”‘’「」『』") {
		return false
	}
	if wechatConsentAnswer(answer) {
		return true
	}
	// ASR sometimes repeats the offered action with a question ending, as in
	// “好，了解一下吗？”. Accept only a complete affirmative plus that same
	// action; a price question, qualification or quoted answer stays a question.
	question := ""
	for _, sentence := range invitationSentences(previous) {
		if followUpQuestion(sentence) {
			question = strings.TrimRight(dialogueText(sentence), "啊呀吧吗么呢")
		}
	}
	t := []rune(dialogueText(answer))
	for n := 1; n < len(t) && n <= 6; n++ {
		if !wechatConsentAnswer(string(t[:n])) {
			continue
		}
		// Derive the echo from the actual offered wording instead of a
		// second hidden keyword list. Intent rules still own keyword hits.
		tail := strings.TrimRight(string(t[n:]), "啊呀吧吗么")
		if len([]rune(tail)) >= 2 && safeWeChatRequest(tail) && (strings.HasSuffix(question, tail) || (len([]rune(tail)) >= 4 && strings.Contains(question, tail))) {
			return true
		}
	}
	return false
}

func followUpInvitationContext(previous string) bool {
	if wechatConsentOffer(previous) {
		return true
	}
	if strings.ContainsAny(previous, "\"“”‘’「」『』") {
		return false
	}
	sentences := invitationSentences(previous)
	if len(sentences) < 2 {
		return false
	}
	last := strings.TrimSpace(sentences[len(sentences)-1])
	// An immediately adjacent, affirmative arrangement may complete a
	// business invitation: “有时间了解一下吗？我加您微信把资料发您。”
	return spokenFollowUpArrangement(last) &&
		intentBusinessInvitation(sentences[len(sentences)-2])
}

func invitationSentences(previous string) []string {
	var sentences []string
	start := 0
	for i, r := range previous {
		if strings.ContainsRune("。.!！?？；;\n\r", r) {
			end := i + len(string(r))
			if part := strings.TrimSpace(previous[start:end]); dialogueText(part) != "" {
				sentences = append(sentences, part)
			}
			start = end
		}
	}
	if part := strings.TrimSpace(previous[start:]); part != "" {
		sentences = append(sentences, part)
	}
	return sentences
}

func (d *dialogueRuntime) acceptedFollowUpReady() bool {
	return (d.invitationAccepted || (d.followUp == "wechat" && d.followUpFocused)) && !d.followUpOtherPending &&
		!d.audioIssue && d.fragment == ""
}
