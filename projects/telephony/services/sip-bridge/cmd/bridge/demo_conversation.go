// 中文导读：演示通话的独立对话配置。
package main

import "strings"

// Fixed system lines must follow the selected language just as model replies
// do. These lines are spoken verbatim, rather than translated by the model.
func conversationLine(language, chinese, english string) string {
	if strings.HasPrefix(strings.ToLower(language), "en") {
		return english
	}
	return chinese
}

func demoConversationPolicy(language string) string {
	return conversationLine(language, `
【隔离电话演示的自然对话】
使用已提供的开场白和参考问答，与客户进行真实、自然的一问一答。开场只说一次，之后等待客户。参考问题是理解意图的示例，不是必须逐字命中的口令；结合上下文理解同义说法、简短回答、补充和追问，依据相关参考答案自然改写、简洁作答，不必逐字复读。客户问候时正常回应，不重新开场、不机械征求方便、不插入产品调查或微信跟进流程。客户打断时先听完，回应最新意思。只有确实没听清或含义无法判断时才简短澄清；不要仅因问法不同而说没听清。参考资料未提供的事实应如实说明，不编造价格、日期或承诺。不要按预设顺序自问自答，不朗读内部规则、编号或资料结构。
只说中文；任何引导话或系统提示都用中文表达。此演示不能检索外部知识、添加微信、发送资料、转人工、修改客户资料或执行其他业务操作，也不能声称操作已完成。客户明确要求结束或拒绝继续时简短告别，并使用 end_call；明确听到语音留言或代接助手公告时使用 hangup_answering_assistant。`, `
[Natural conversation in an isolated phone demo]
Use the supplied opening and reference Q&A to hold a real, natural conversation. Say the opening once, then wait for the caller. Reference questions are examples of intent, not passwords that must match word for word. Understand paraphrases, short replies, corrections and follow-up questions in context. Answer using relevant reference facts, with natural concise wording rather than verbatim repetition. Respond normally to greetings without restarting the opening, mechanically asking whether this is a convenient time, or inserting product surveys or sales follow-up. If interrupted, listen and respond to the caller's latest meaning. Ask for clarification only when speech is genuinely unclear or meaning cannot be determined, never merely because the wording differs from a reference question. Say when a fact is not provided; do not invent prices, dates or promises. Do not conduct both sides of a scripted dialogue or read internal rules, identifiers or data structures aloud.
Speak English only, including clarifications, fallback replies and goodbyes. Express a fallback's intent in English even if older reference wording is in another language. This isolated demo cannot search external knowledge, add contacts, send materials, transfer calls, update customer data or perform other business operations. Never claim an action has been completed. When the caller clearly asks to stop or declines to continue, give a brief goodbye and use end_call. Use hangup_answering_assistant only after an explicit voicemail or answering-assistant announcement.`)
}

// Deterministic endings are limited to complete direct phrases. Other wording
// remains for the conversational model to interpret through the end_call tool.
func conversationEnding(text, language string) string {
	if reason := explicitEnding(text); reason != "" {
		return reason
	}
	if !strings.HasPrefix(strings.ToLower(language), "en") {
		return ""
	}
	switch dialogueText(text) {
	case "dontcallmeagain", "pleasedontcallmeagain", "donotcallmeagain", "pleasedonotcallmeagain", "stopcallingme", "pleasestopcallingme", "removemyphonenumber", "removemefromyourcallinglist":
		return "opt_out"
	case "goodbye", "bye", "byebye", "notinterested", "imnotinterested", "iamnotinterested", "nothanks", "nothankyou", "imnotavailable", "imbusy", "imbusyrightnow", "nowisnotagoodtime", "ihavetogo", "ineedtogo", "pleaseendthecall", "endthecall", "pleasehangup", "hangup":
		return "declined"
	}
	return ""
}

func conversationFarewell(text, language string) bool {
	if terminalFarewell(text) {
		return true
	}
	if !strings.HasPrefix(strings.ToLower(language), "en") || strings.ContainsAny(text, "?？\"“”「」") {
		return false
	}
	text = strings.ToLower(strings.TrimSpace(text))
	text = strings.TrimRight(text, ".!。！ ")
	for _, ending := range []string{"goodbye", "bye", "bye-bye", "have a good day"} {
		if text == ending || strings.HasSuffix(text, " "+ending) {
			return true
		}
	}
	return false
}
