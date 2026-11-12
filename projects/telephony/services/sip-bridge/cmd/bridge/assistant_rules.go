// 中文导读：语音助手识别与拦截规则的运行时处理。
package main

import (
	"strings"
	"unicode"
)

type assistantDetectionRule struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Keywords         []string `json:"keywords"`
	NegativeKeywords []string `json:"negativeKeywords"`
	Enabled          bool     `json:"enabled"`
	MatchMode        string   `json:"matchMode,omitempty"`
}

type assistantDetectionRuleMatch struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Keyword string `json:"keyword"`
}

type assistantDetectionMatch struct {
	Detected  bool                          `json:"detected"`
	Rules     []assistantDetectionRuleMatch `json:"rules"`
	Evidence  string                        `json:"evidence"`
	At        string                        `json:"at,omitempty"`
	MessageID string                        `json:"messageId,omitempty"`
}

var assistantMentionExclusions = []string{"我不是语音助手", "我不是智能助手", "我不是智能助理", "不是代接", "不是语音信箱", "我用的语音助手", "我自己的语音助手", "你是语音助手吗", "你是智能助手吗"}

// Keep the announcement contract in sync with crm/assistant-announcement.ts.
// A name alone is not an automated announcement, regardless of the rule ID.
var assistantIdentityNames = []string{"机主的智能助理", "机主的智能助手", "机主的电话助理", "机主的语音助手", "主人的智能助理", "主人的智能助手", "小爱同学", "小艾同学", "小爱电话助理", "小艺通话助手", "机器人助手", "智能电话助手", "智能接听助理", "智能接听助手", "电话代接助手", "语音代接助手", "小爱", "小艾", "小艺", "小布", "小v", "语音助手", "智能助理", "智能助手", "电话助理", "接听助理", "接听助手", "通话助手"}
var assistantAnnouncementIntroductions = []string{"我是", "这里是", "我这边是", "您正在与"}
var assistantAnnouncementProducts = []string{"产品", "的产品", "研发", "开发", "销售", "行业", "公司"}
var assistantAnnouncementReported = []string{"刚才", "他说", "她说", "你说", "我说", "听见", "听到", "你是", "您是", "不是", "不想用", "什么意思", "啥意思", "怎么回事", "为什么", "提示说", "显示"}
var assistantAnnouncementCarrierPrefixes = []string{"您拨打的电话正在通话中", "你拨打的电话正在通话中", "您拨打的用户正在通话中", "你拨打的用户正在通话中", "您拨打的电话暂时无法接听", "你拨打的电话暂时无法接听", "您拨打的用户暂时无法接听", "你拨打的用户暂时无法接听", "您拨打的电话无人接听", "你拨打的电话无人接听", "您拨打的用户无人接听", "你拨打的用户无人接听"}
var assistantUnavailableParts = []string{"无法接听", "无人接听", "无法接通", "不能接听", "未能接通", "正在通话中", "unavailable"}
var assistantNotificationParts = []string{"通知", "短信提醒", "来电提醒", "通话提醒"}

type assistantAnnouncementHead struct {
	head      string
	introHead string
	reported  bool
}

var defaultAssistantDetectionRules = []assistantDetectionRule{
	{ID: "builtin.assistant.screening", Name: "无身份代接和留言指令", Keywords: []string{"请留下.*姓名.*来电原因", "我会帮你确认.*是否方便接听", "我会帮您确认.*是否方便接听", "此人暂时无法接听.*提示音后", "若要留言.*提示音后", "请在提示音后.*回复"}, NegativeKeywords: assistantMentionExclusions, MatchMode: "semantic", Enabled: true},
	{ID: "builtin.assistant.voicemail", Name: "语音信箱和留言播报", Keywords: []string{"转至语音留言", "转到语音留言", "转入语音留言", "转至语音信箱", "转入语音信箱", "话已转至语音留言", "话已转到语音留言", "话已转入语音留言", "话已转至语音信箱", "电话已转至语音留言", "电话已转入语音信箱", "已转至语音留言", "已转到语音留言", "已转入语音留言", "已转至语音信箱", "已转入语音信箱", "通话已转入语音留言", "你尝试联系的用户无法接听", "您尝试联系的用户无法接听", "您的呼叫现在无法接听", "您的呼叫暂时无法接听", "本次呼叫.*通知", "此次呼叫.*通知", "通话已转至语音留言", "通话已转到语音留言", "您的通话已转至语音留言", "您拨打的电话已转入语音信箱", "您拨打的电话已转至语音信箱", "欢迎使用语音信箱", "这里是语音信箱", "请在提示音后留言", "请在提示音后录制留言", "请在嘟声后留言", "请在滴声后留言", "我是语音信箱", "thepersonyouaretryingtoreachisunavailable", "yourcallhasbeenforwardedtovoicemail", "pleaseleaveamessageafterthetone", "语音留言", "语音信箱", "语音流言"}, NegativeKeywords: assistantMentionExclusions, Enabled: true},
	{ID: "builtin.assistant.explicit", Name: "明确智能代接播报", Keywords: []string{"我是机器人助手", "我是智能电话助手", "我是机主的电话助理", "我是机主的语音助手", "我是小爱同学", "我是小艾同学", "我是小爱电话助理", "我是小艺通话助手", "我是智能接听助理", "我是智能接听助手", "我是电话代接助手", "我是语音代接助手"}, NegativeKeywords: assistantMentionExclusions, Enabled: true},
	{ID: "builtin.assistant.named", Name: "手机助手代接声明", Keywords: []string{"机主的智能助理", "机主的智能助手", "机主的电话助理", "机主的语音助手", "主人的智能助理", "主人的智能助手", "小爱同学", "小艾同学", "小爱电话助理", "小艺通话助手", "机器人助手", "智能电话助手", "智能接听助理", "智能接听助手", "电话代接助手", "语音代接助手", "小爱", "小艾", "小艺", "小布", "小v", "语音助手", "智能助理", "智能助手", "电话助理", "接听助理", "接听助手", "通话助手"}, NegativeKeywords: assistantMentionExclusions, Enabled: true},
}

// Each call evaluates its frozen rule snapshot. Nil retains defaults for
// older jobs; an explicit empty array disables all answering detection.
func matchAssistantDetection(text string, rules []assistantDetectionRule) *assistantDetectionMatch {
	if rules == nil {
		rules = defaultAssistantDetectionRules
	}
	original := strings.Join(strings.Fields(text), " ")
	normalized := normalizeAssistantText(original)
	if normalized == "" {
		return nil
	}
	quoted := assistantQuotedAnnouncement(original)
	announcement := buildAssistantAnnouncementHead(normalized)
	matches := []assistantDetectionRuleMatch{}
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		vetoed := false
		for _, negative := range rule.NegativeKeywords {
			if phrase := normalizeAssistantText(negative); phrase != "" && strings.Contains(normalized, phrase) {
				vetoed = true
				break
			}
		}
		if vetoed {
			continue
		}
		for _, keyword := range rule.Keywords {
			accepted := false
			if rule.MatchMode == "keyword" {
				accepted = matchesAssistantKeywordText(normalized, keyword)
			} else if !quoted {
				accepted = matchesAssistantAnnouncementKeyword(announcement, keyword, rule.ID == "builtin.assistant.named")
			}
			if accepted {
				matches = append(matches, assistantDetectionRuleMatch{ID: rule.ID, Name: rule.Name, Keyword: keyword})
				if len(matches) >= 12 {
					return &assistantDetectionMatch{Detected: true, Rules: matches, Evidence: boundRunes(original, 600)}
				}
			}
		}
	}
	if len(matches) == 0 {
		return nil
	}
	return &assistantDetectionMatch{Detected: true, Rules: matches, Evidence: boundRunes(original, 600)}
}

// Keyword mode is an explicit administrator choice. It bypasses announcement
// semantics; rule-level exclusions still take precedence in the caller.
func matchesAssistantKeywordText(normalized, keyword string) bool {
	parts := strings.Split(keyword, ".*")
	if normalized == "" || len(parts) > 5 {
		return false
	}
	end := 0
	for _, part := range parts {
		part = normalizeAssistantText(part)
		if part == "" {
			return false
		}
		position := strings.Index(normalized[end:], part)
		if position < 0 {
			return false
		}
		end += position + len(part)
	}
	return true
}

func buildAssistantAnnouncementHead(normalized string) assistantAnnouncementHead {
	head := boundRunes(stripAssistantGreetings(normalized), 120)
	reported := false
	for _, phrase := range append(append([]string{}, assistantAnnouncementReported...), assistantMentionExclusions...) {
		if strings.Contains(head, phrase) {
			reported = true
			break
		}
	}
	introHead := head
	if !reported {
		for _, prefix := range assistantAnnouncementCarrierPrefixes {
			if strings.HasPrefix(head, prefix) {
				introHead = stripAssistantGreetings(strings.TrimPrefix(head, prefix))
				break
			}
		}
	}
	introHead = boundRunes(introHead, 70)
	_, suffix, knownIdentity := assistantKnownIntroduction(introHead)
	reported = reported || knownIdentity && assistantProductSuffix(suffix)
	return assistantAnnouncementHead{head: head, introHead: introHead, reported: reported}
}

func matchesAssistantAnnouncement(context assistantAnnouncementHead, phrase string, identityOnly bool) bool {
	if phrase == "" || context.head == "" || context.reported {
		return false
	}
	if len([]rune(phrase)) >= 4 && assistantStructuredProxy(context.head) && assistantPhrasePresent(context.head, phrase) {
		return true
	}
	if phrase == "语音留言" || phrase == "语音信箱" || phrase == "语音流言" {
		return !identityOnly && contextualVoicemail(context.head, phrase) && assistantPhrasePresent(context.head, phrase)
	}
	identity, isName := assistantIdentityKeyword(phrase)
	if !isName {
		identity = phrase
	}
	named := namedAssistantAnnouncement(context.introHead, identity)
	if !identityOnly && !isName && (assistantExactPart(phrase, assistantUnavailableParts) || assistantExactPart(phrase, assistantNotificationParts)) && assistantCarrierAnnouncement(context.head) && assistantPhrasePresent(context.head, phrase) {
		return true
	}
	// A custom rule cannot turn a mobile-assistant name or a generic short
	// word into an unconditional hangup. Explicit self-identifications using
	// those same names also need the answering duty in this bounded turn.
	if identityOnly || isName || len([]rune(phrase)) < 6 {
		return named
	}
	if strings.HasPrefix(context.head, phrase) {
		return true
	}
	// Only complete automated-broadcast features gain contained matching.
	// Ordinary long phrases keep their existing announcement-start semantics.
	return named || assistantBroadcastFeature(phrase) && assistantPhrasePresent(context.head, phrase)
}

// Literal ".*" separates at most five ordered pieces in the 120-rune
// announcement head. No administrator-supplied regular expression is run.
func matchesAssistantAnnouncementKeyword(context assistantAnnouncementHead, keyword string, identityOnly bool) bool {
	if assistantQuotedAnnouncement(keyword) || context.head == "" || context.reported {
		return false
	}
	if !strings.Contains(keyword, ".*") {
		return matchesAssistantAnnouncement(context, normalizeAssistantText(keyword), identityOnly)
	}
	parts := strings.Split(keyword, ".*")
	if identityOnly && !assistantStructuredProxy(context.head) || len(parts) > 5 {
		return false
	}
	for index, part := range parts {
		parts[index] = normalizeAssistantText(part)
		if parts[index] == "" {
			return false
		}
	}
	if len([]rune(strings.Join(parts, ""))) < 6 {
		return false
	}
	start, end := -1, 0
	for _, part := range parts {
		position := strings.Index(context.head[end:], part)
		if position < 0 {
			return false
		}
		position += end
		if !assistantPhraseAllowedAt(context.head, position) {
			return false
		}
		if start < 0 {
			start = position
		}
		end = position + len(part)
	}
	_, firstIsName := assistantIdentityKeyword(parts[0])
	return assistantStructuredProxy(context.head) || assistantCarrierAnnouncement(context.head) || assistantBroadcastFeature(context.head[start:end]) || start == 0 && len([]rune(parts[0])) >= 6 && !firstIsName
}

// Keep the screening/voicemail semantic contract identical to the API helper.
func assistantStructuredProxy(head string) bool {
	identityRequest := false
	for _, prefix := range []string{"请留下", "请说出", "请告知", "请提供", "请说明"} {
		identityRequest = identityRequest || strings.HasPrefix(head, prefix)
	}
	identityRequest = identityRequest && assistantSpokenPart(head, []string{"姓名", "名字"}) && assistantSpokenPart(head, []string{"来电原因", "来电事由"})
	screeningDuty := assistantSpokenPart(head, []string{"我会帮你确认", "我会帮您确认", "我将帮你确认", "我将帮您确认", "我会为你确认", "我会为您确认"}) && assistantSpokenPart(head, []string{"此人", "机主", "主人", "对方"}) && assistantSpokenPart(head, []string{"是否方便接听", "是否能够接听", "是否可以接听"})
	if screeningDuty && (identityRequest || (strings.HasPrefix(head, "我会") || strings.HasPrefix(head, "我将")) && assistantSpokenPart(head, []string{"此人", "机主", "主人"})) {
		return true
	}
	if !assistantSpokenPart(head, []string{"提示音后", "嘟声后", "滴声后", "蜂鸣声后"}) || !assistantSpokenPart(head, []string{"留言", "录制留言", "回复"}) {
		return false
	}
	for _, prefix := range []string{"请在", "若要留言", "如需留言", "如果需要留言", "此人暂时无法接听", "对方暂时无法接听", "机主暂时无法接听", "主人暂时无法接听"} {
		if strings.HasPrefix(head, prefix) {
			return true
		}
	}
	return false
}

// Rule enablement controls hangup. Independently, an automated announcement
// cannot prove business interest even if a workspace disables that hangup.
func automaticAssistantAnnouncement(text string) bool {
	if assistantQuotedAnnouncement(text) {
		return false
	}
	context := buildAssistantAnnouncementHead(normalizeAssistantText(text))
	if context.head == "" || context.reported {
		return false
	}
	if assistantStructuredProxy(context.head) || assistantCarrierAnnouncement(context.head) {
		return true
	}
	_, suffix, known := assistantKnownIntroduction(context.introHead)
	if known && !assistantProductSuffix(suffix) && answeringProxyDuty(context.introHead) {
		return true
	}
	for _, prefix := range []string{"转至", "转到", "转入", "电话已", "话已", "已转", "通话已", "您的通话", "您拨打", "你拨打", "欢迎使用语音信箱", "这里是语音信箱", "我是语音信箱", "请在提示音后", "请在嘟声后", "请在滴声后", "请在蜂鸣声后", "请在录音完成后", "yourcallhasbeen", "pleaseleaveamessageafterthetone"} {
		if strings.HasPrefix(context.head, prefix) && assistantBroadcastFeature(context.head) {
			return true
		}
	}
	return false
}

func assistantQuotedAnnouncement(text string) bool {
	return strings.ContainsAny(text, "“”‘’「」『』\"'")
}

func assistantExactPart(text string, parts []string) bool {
	for _, part := range parts {
		if text == part {
			return true
		}
	}
	return false
}

// Recognize complete carrier clauses independently when ASR splits the notice
// across turns. A human's "我现在无法接听" does not qualify.
func assistantCarrierAnnouncement(head string) bool {
	for _, prefix := range []string{"本次呼叫将以", "此次呼叫将以", "本次通话将以"} {
		if strings.HasPrefix(head, prefix) && assistantPhrasePresent(head, "方式") && assistantSpokenPart(head, assistantNotificationParts) {
			return true
		}
	}
	if !assistantSpokenPart(head, assistantUnavailableParts) {
		return false
	}
	for _, prefix := range []string{"您拨打的电话", "你拨打的电话", "您拨打的用户", "你拨打的用户", "您尝试联系的用户", "你尝试联系的用户", "thepersonyouaretryingtoreach"} {
		if strings.HasPrefix(head, prefix) {
			return true
		}
	}
	for _, prefix := range []string{"您的呼叫现在无法接听", "您的呼叫暂时无法接听", "你的呼叫现在无法接听", "你的呼叫暂时无法接听"} {
		if strings.HasPrefix(head, prefix) {
			return true
		}
	}
	for _, prefix := range []string{"您的呼叫", "你的呼叫", "本次呼叫", "此次呼叫", "本次通话"} {
		if strings.HasPrefix(head, prefix) && assistantSpokenPart(head, assistantNotificationParts) {
			return true
		}
	}
	return false
}

func assistantSpokenPart(text string, parts []string) bool {
	for _, part := range parts {
		if assistantPhrasePresent(text, part) {
			return true
		}
	}
	return false
}

func assistantIdentityKeyword(phrase string) (string, bool) {
	subject := phrase
	for _, intro := range assistantAnnouncementIntroductions {
		if strings.HasPrefix(subject, intro) {
			subject = strings.TrimPrefix(subject, intro)
			break
		}
	}
	for _, name := range assistantIdentityNames {
		if subject == name {
			return subject, true
		}
	}
	// An unfamiliar product name ending in a generic assistant identity is
	// still an identity, rather than a complete automatic broadcast.
	for _, suffix := range []string{"助手", "助理", "同学"} {
		if strings.HasSuffix(subject, suffix) {
			return subject, true
		}
	}
	return "", false
}

func namedAssistantAnnouncement(head, identity string) bool {
	for _, intro := range assistantAnnouncementIntroductions {
		prefix := intro + identity
		if strings.HasPrefix(head, prefix) && !assistantProductSuffix(strings.TrimPrefix(head, prefix)) && answeringProxyDuty(head) {
			return true
		}
	}
	return false
}

func assistantProductSuffix(suffix string) bool {
	for _, product := range assistantAnnouncementProducts {
		if strings.HasPrefix(suffix, product) {
			return true
		}
	}
	return false
}

func assistantBroadcastFeature(phrase string) bool {
	if len([]rune(phrase)) < 6 {
		return false
	}
	if assistantStructuredProxy(phrase) {
		return true
	}
	// A mailbox reference must itself describe routing, a mailbox identity,
	// or a recording instruction. Merely mentioning voicemail is not enough.
	voicemail := containsAssistantPart(phrase, []string{"语音留言", "语音信箱", "语音流言", "voicemail"})
	if voicemail && containsAssistantPart(phrase, []string{"转至", "转到", "转入", "已转", "欢迎使用", "这里是", "我是", "forwarded", "welcometo", "thisis"}) {
		return true
	}
	if containsAssistantPart(phrase, []string{"提示音后", "嘟声后", "滴声后", "蜂鸣声后", "录音完成后"}) && strings.Contains(phrase, "留言") {
		return true
	}
	if strings.Contains(phrase, "leaveamessage") && strings.Contains(phrase, "afterthetone") {
		return true
	}
	if containsAssistantPart(phrase, []string{"您拨打", "你拨打", "您尝试联系的用户", "你尝试联系的用户", "thepersonyouaretryingtoreach"}) && containsAssistantPart(phrase, []string{"无法接听", "无人接听", "正在通话中", "unavailable"}) {
		return true
	}
	if assistantCarrierAnnouncement(phrase) {
		return true
	}
	// A complete self-introduction plus an answering duty is safe even if a
	// carrier preamble or ASR overlap precedes that complete feature.
	_, suffix, knownIdentity := assistantKnownIntroduction(phrase)
	return knownIdentity && !assistantProductSuffix(suffix) && answeringProxyDuty(phrase)
}

func assistantKnownIntroduction(head string) (string, string, bool) {
	for _, intro := range assistantAnnouncementIntroductions {
		if !strings.HasPrefix(head, intro) {
			continue
		}
		subject := strings.TrimPrefix(head, intro)
		longest := ""
		for _, name := range assistantIdentityNames {
			if strings.HasPrefix(subject, name) && len(name) > len(longest) {
				longest = name
			}
		}
		if longest != "" {
			return longest, strings.TrimPrefix(subject, longest), true
		}
	}
	return "", "", false
}

func containsAssistantPart(text string, parts []string) bool {
	for _, part := range parts {
		if strings.Contains(text, part) {
			return true
		}
	}
	return false
}

func assistantPhrasePresent(head, phrase string) bool {
	if phrase == "" {
		return false
	}
	for start := 0; start < len(head); {
		position := strings.Index(head[start:], phrase)
		if position < 0 {
			return false
		}
		position += start
		if assistantPhraseAllowedAt(head, position) {
			return true
		}
		start = position + len(phrase)
	}
	return false
}

func assistantPhraseAllowedAt(head string, position int) bool {
	before := []rune(head[:position])
	prefix := string(before[maxInt(0, len(before)-8):])
	// Ignore modifiers between an explicit negation and the feature, but
	// do not treat unrelated warnings such as “不要挂断” as a negation.
	for i := 0; i < 2; i++ {
		for _, modifier := range []string{"已经", "自动", "直接", "再次", "现在", "进行", "予以", "被"} {
			prefix = strings.TrimSuffix(prefix, modifier)
		}
	}
	for _, negative := range []string{"没有", "并未", "从未", "不会", "不是", "并非", "不要", "不曾", "不想", "不用", "未", "没", "不"} {
		if strings.HasSuffix(prefix, negative) {
			return false
		}
	}
	return true
}

func stripAssistantGreetings(text string) string {
	for i := 0; i < 5; i++ {
		before := text
		for _, greeting := range []string{"您好", "你好", "喂", "哎", "嗯", "很抱歉", "非常抱歉", "抱歉", "对不起", "sorry", "hello", "hi"} {
			text = strings.TrimPrefix(text, greeting)
		}
		if text == before {
			break
		}
	}
	return text
}

func contextualVoicemail(head, phrase string) bool {
	if !strings.Contains(head, phrase) {
		return false
	}
	prefixMatch := false
	for _, prefix := range []string{"话已", "电话已", "通话已", "已转", "转至", "转入", "您的电话", "您拨打", "你拨打"} {
		prefixMatch = prefixMatch || strings.HasPrefix(head, prefix)
	}
	return prefixMatch && (strings.Contains(head, "无法接听") || strings.Contains(head, "提示音后") || strings.Contains(head, "录音完成后"))
}

func normalizeAssistantText(value string) string {
	return strings.Map(func(r rune) rune {
		if r >= 0xFF01 && r <= 0xFF5E {
			r -= 0xFEE0
		}
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, value)
}

func boundRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}
