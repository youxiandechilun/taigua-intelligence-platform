// 中文导读：客户意向识别规则的运行时处理。
package main

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf16"
)

// intentRule is a bounded, workspace-scoped rule snapshot. The API owns the
// rules; the bridge only evaluates the frozen snapshot that arrived with one
// call so a settings edit cannot change an active conversation halfway through.
type intentRule struct {
	ID               string   `json:"id"`
	Name             string   `json:"name,omitempty"`
	Intent           string   `json:"intent"`
	Keywords         []string `json:"keywords"`
	PositiveKeywords []string `json:"positiveKeywords,omitempty"`
	NegativeKeywords []string `json:"negativeKeywords"`
	MatchMode        string   `json:"matchMode,omitempty"`
	ApplyTo          []string `json:"applyTo,omitempty"`
	ReplyHint        string   `json:"replyHint,omitempty"`
	Action           string   `json:"action,omitempty"`
	Priority         int      `json:"priority"`
	Enabled          bool     `json:"enabled"`
}

type intentRuleMatch struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	Intent   string `json:"intent"`
	Keyword  string `json:"keyword"`
	Priority int    `json:"priority"`
}

type intentMatch struct {
	Intent   string            `json:"intent"`
	Evidence string            `json:"evidence"`
	Rules    []intentRuleMatch `json:"rules"`
}

// matchIntentRules deliberately runs before positive matching. This prevents
// phrases such as “不需要了解” or “不要再联系” from becoming an interested
// hit merely because they contain a configured positive keyword.
func matchIntentRules(text string, rules []intentRule, scope string, previousAgent ...string) *intentMatch {
	normalized := normalizeIntentText(text)
	if normalized == "" || len(rules) == 0 {
		return nil
	}
	previous := ""
	if len(previousAgent) > 0 {
		previous = previousAgent[0]
	}

	candidates := []intentRuleMatch{}
	for _, rule := range rules {
		if !rule.Enabled || !validIntent(rule.Intent) || !ruleAppliesTo(rule, scope) {
			continue
		}
		// A greeting or identity check is not business interest, even if an
		// administrator configured a broad keyword such as "好" or "你好".
		// Keep refusals eligible. Weak acknowledgements need their own full
		// utterance and the immediately preceding business invitation below.
		if strings.EqualFold(strings.TrimSpace(rule.Intent), "interested") && (intentContactCheckOnly(text) || automaticAssistantAnnouncement(text)) {
			continue
		}
		// A rule-level negative phrase vetoes the rule for this utterance.
		vetoed := false
		for _, negative := range compactIntentKeywords(rule.NegativeKeywords) {
			if phraseIn(normalized, negative) {
				vetoed = true
				break
			}
		}
		if vetoed {
			continue
		}
		configuredKeywords := rule.Keywords
		if len(configuredKeywords) == 0 {
			configuredKeywords = rule.PositiveKeywords
		}
		// Match the API's compactList: punctuation-only entries are ignored,
		// including in an all-words rule, and equivalent entries count once.
		keywords := compactIntentKeywords(configuredKeywords)
		if len(keywords) == 0 {
			continue
		}
		if strings.EqualFold(strings.TrimSpace(rule.MatchMode), "all") {
			allPresent := true
			for _, key := range keywords {
				if !intentKeywordPresent(normalized, key, rule.Intent, text, previous) || strings.EqualFold(strings.TrimSpace(rule.Intent), "interested") && negatedNear(normalized, key) {
					allPresent = false
					break
				}
			}
			if !allPresent {
				continue
			}
		}
		for _, key := range keywords {
			if !intentKeywordPresent(normalized, key, rule.Intent, text, previous) || strings.EqualFold(strings.TrimSpace(rule.Intent), "interested") && negatedNear(normalized, key) {
				continue
			}
			match := intentRuleMatch{ID: rule.ID, Name: rule.Name, Intent: strings.ToLower(strings.TrimSpace(rule.Intent)), Keyword: key, Priority: rule.Priority}
			if !hasRuleMatch(candidates, match.ID, match.Keyword) {
				candidates = append(candidates, match)
			}
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	// Match the API ordering exactly: priority, refusal/opt-out rank, then
	// the normalized keyword length. Stable sorting preserves rule order
	// only when all three values are equal.
	sort.SliceStable(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if a.Priority != b.Priority {
			return a.Priority > b.Priority
		}
		if intentRank(a.Intent) != intentRank(b.Intent) {
			return intentRank(a.Intent) > intentRank(b.Intent)
		}
		return len(utf16.Encode([]rune(a.Keyword))) > len(utf16.Encode([]rune(b.Keyword)))
	})
	winner := candidates[0].Intent
	matched := make([]intentRuleMatch, 0, min(12, len(candidates)))
	for _, candidate := range candidates {
		if candidate.Intent == winner {
			matched = append(matched, candidate)
			if len(matched) == 12 {
				break
			}
		}
	}
	return &intentMatch{Intent: winner, Evidence: strings.TrimSpace(text), Rules: matched}
}

// A configured short acknowledgement is a candidate only when the complete
// reply accepts a concrete business invitation. In particular, the character
// “行” inside “进行通知” is not an agreement, and “好，我现在听到了” only
// confirms audibility. Rules retain their workspace scope and enabled state.
func intentKeywordPresent(normalized, key, intent, original, previous string) bool {
	if !phraseIn(normalized, key) {
		return false
	}
	return !strings.EqualFold(strings.TrimSpace(intent), "interested") || !weakIntentKeyword(key) ||
		(wholeIntentAffirmative(original) && intentBusinessInvitation(previous)) || acceptedBusinessInvitation(original, previous)
}

func weakIntentKeyword(keyword string) bool {
	key := normalizeIntentText(keyword)
	if len([]rune(key)) <= 1 {
		return true
	}
	switch key {
	case "好的", "好啊", "好呀", "好吧", "好嘞", "可以", "可以的", "可以啊", "非常可以", "行的", "行啊", "嗯嗯", "对的", "是的", "没问题", "没事", "同意", "ok", "okay", "yes", "yeah", "yep", "sure", "alright", "allright":
		return true
	}
	return false
}

func wholeIntentAffirmative(text string) bool {
	if followUpQuestion(text) || strings.ContainsAny(text, "\"“”‘’「」『』") {
		return false
	}
	t := normalizeIntentText(text)
	if t == "" || len([]rune(t)) > 32 {
		return false
	}
	// Consume complete tokens instead of looking for a positive substring.
	// Neither an unrelated noun phrase nor a qualified answer can disappear.
	for t != "" {
		before := t
		for _, token := range []string{"allright", "alright", "非常可以", "可以的", "可以啊", "没问题", "没事", "okay", "yeah", "sure", "yep", "yes", "好的", "好啊", "好呀", "好吧", "好嘞", "可以", "行的", "行啊", "对的", "是的", "同意", "嗯嗯", "ok", "好", "行", "嗯", "对", "是", "中"} {
			if strings.HasPrefix(t, token) {
				t = strings.TrimPrefix(t, token)
				break
			}
		}
		if t == before {
			return false
		}
	}
	return true
}

func intentBusinessInvitation(previous string) bool {
	if strings.TrimSpace(previous) == "" || strings.ContainsAny(previous, "\"“”‘’「」『』") {
		return false
	}
	// Only the final sentence supplies the question being answered. A product
	// mentioned before a hearing or availability check does not change it.
	clauses := strings.FieldsFunc(previous, func(r rune) bool {
		return strings.ContainsRune("。！？.!?", r)
	})
	if len(clauses) == 0 {
		return false
	}
	t := normalizeIntentText(clauses[len(clauses)-1])
	// Alternative invitation questions contain a negative half without
	// withdrawing the offer. Keep other negative wording in the clause intact.
	exclusionText := strings.NewReplacer("需要不需要", "需要", "需不需要", "需要", "要不要", "要").Replace(t)
	for _, excluded := range []string{"听到", "听见", "声音", "有声", "哪位", "本人", "您是老板", "你是老板", "您是负责人", "你是负责人", "您是机主", "你是机主", "您是哪", "你是哪", "您是谁", "你是谁", "是不是老板", "方便说话", "方便接听", "方便接电话", "方便通话", "现在方便吗", "有空吗", "忙吗", "方便聊两句", "再见", "先忙", "不用", "不需要", "不要", "别加", "不加微信", "已经加", "加过", "已经发", "发过", "canyouhearme", "yourname", "speakingto", "areyoubusy", "goodbye"} {
		if strings.Contains(exclusionText, excluded) {
			return false
		}
	}
	ending := strings.TrimSpace(previous)
	question := strings.HasSuffix(ending, "?") || strings.HasSuffix(ending, "？") || strings.HasSuffix(t, "吗") || strings.HasSuffix(t, "么") || strings.HasSuffix(t, "呢")
	proposal, business := false, false
	for _, phrase := range []string{"要不要", "需不需要", "想不想", "可不可以", "能不能", "是否", "愿意", "感兴趣", "方便", "可以", "好吗", "好不好", "行吗", "行不行", "需要", "要吗", "想了解", "了解一下", "要参加", "要试用", "要资料", "要报价", "想听", "wouldyou", "mayi", "cani", "doyouwant", "areyouinterested", "woulditbeokay"} {
		proposal = proposal || strings.Contains(t, phrase)
	}
	for _, phrase := range []string{"了解", "介绍", "资料", "方案", "报价", "样品", "试用", "体验", "演示", "预约", "咨询", "合作", "参加", "直播", "课程", "产品", "服务", "订单", "采购", "微信", "发给", "发送", "information", "details", "quote", "quotation", "sample", "trial", "demo", "appointment", "presentation", "product", "service", "wechat", "sendyou", "sendit", "learnmore", "learnabout"} {
		business = business || strings.Contains(t, phrase)
	}
	return question && proposal && business
}

func intentContactCheckOnly(text string) bool {
	if greetingAcknowledgement(text) || introductionQuestion(text, "zh") || introductionQuestion(text, "en") {
		return true
	}
	t := normalizeIntentText(text)
	for t != "" {
		before := t
		for _, greeting := range []string{"hello", "hiya", "hey", "hi"} {
			if strings.HasPrefix(t, greeting) {
				t = strings.TrimPrefix(t, greeting)
				break
			}
		}
		if before == t {
			return false
		}
	}
	return strings.TrimSpace(text) != ""
}

func intentRank(intent string) int {
	switch intent {
	case "optout":
		return 4
	case "uninterested":
		return 3
	case "interested":
		return 2
	case "unclear":
		return 1
	default:
		return 0
	}
}

func ruleAppliesTo(rule intentRule, scope string) bool {
	if len(rule.ApplyTo) == 0 {
		return true
	}
	for _, value := range rule.ApplyTo {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == scope || (scope != "manual" && value == "assistant") {
			return true
		}
	}
	return false
}

func validIntent(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "interested", "unclear", "uninterested", "optout":
		return true
	default:
		return false
	}
}

func normalizeIntentText(value string) string {
	return strings.Map(func(r rune) rune {
		if r >= 0xFF01 && r <= 0xFF5E {
			r -= 0xFEE0
		}
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, value)
}

func phraseIn(text, phrase string) bool {
	key := normalizeIntentText(phrase)
	return key != "" && strings.Contains(text, key)
}

func compactIntentKeywords(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		key := normalizeIntentText(value)
		if key != "" && !seen[key] {
			seen[key] = true
			result = append(result, key)
		}
	}
	return result
}

// negatedNear handles the common “不/没/不要 + keyword” form without
// requiring every workspace to duplicate the same negative vocabulary in each
// rule. The window is intentionally short so a negation from an earlier
// sentence does not cancel a later positive statement.
func negatedNear(text, phrase string) bool {
	key := normalizeIntentText(phrase)
	if key == "" {
		return false
	}
	start := strings.Index(text, key)
	if start < 0 {
		return false
	}
	before := []rune(text[:start])
	prefix := string(before[maxInt(0, len(before)-10):])
	for _, negative := range []string{"不", "没", "无", "别", "不要", "不用", "不想", "不感兴趣", "不需要", "暂时不", "不考虑", "拒绝"} {
		if strings.Contains(prefix, negative) {
			return true
		}
	}
	return false
}

func hasRuleMatch(matches []intentRuleMatch, id, keyword string) bool {
	for _, match := range matches {
		if match.ID == id && match.Keyword == keyword {
			return true
		}
	}
	return false
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
