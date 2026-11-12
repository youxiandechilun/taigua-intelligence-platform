// 中文导读：共享基础能力：opening_speech_rules.go。供 SIP 语音桥中的相关模块调用。
package main

import (
	"errors"
	"strings"
	"unicode"
)

// Frozen per request by the workspace authority. Never shared between calls.
type openingInterruptionRules struct {
	LockOpening             bool     `json:"lockOpening"`
	AcknowledgementKeywords []string `json:"acknowledgementKeywords"`
	InterruptKeywords       []string `json:"interruptKeywords"`
}

var defaultOpeningSpeechRules = openingInterruptionRules{
	AcknowledgementKeywords: []string{"嗯", "嗯嗯", "喂", "你好", "您好", "哦", "噢", "啊", "呃", "好", "好的", "明白", "明白了", "知道了", "了解", "收到", "对", "是的", "行", "hello", "hi", "hey", "um", "uh", "oh", "ok", "okay", "right", "got it", "I see"},
	InterruptKeywords:       []string{"不需要", "不要", "别打", "不方便", "没兴趣", "再见", "哪位", "什么公司", "什么事", "收费", "多少钱", "怎么", "为什么", "有意向", "感兴趣", "发我", "加微信", "no thanks", "not interested", "stop calling", "who are you", "how much", "interested"},
}

func openingCompact(text string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, text)
}

func validateOpeningInterruptionRules(rules *openingInterruptionRules) error {
	if rules == nil {
		return nil
	}
	for _, list := range [][]string{rules.AcknowledgementKeywords, rules.InterruptKeywords} {
		for _, word := range list {
			if len([]rune(word)) > 80 || openingCompact(word) == "" {
				return errors.New("invalid opening keyword")
			}
		}
	}
	return nil
}

func openingSpeechSubstantive(text string, rules *openingInterruptionRules) bool {
	if rules == nil {
		rules = &defaultOpeningSpeechRules
	}
	value := openingCompact(text)
	if value == "" {
		return false
	}
	for _, word := range rules.InterruptKeywords {
		token := openingCompact(word)
		if token != "" && strings.Contains(value, token) {
			return true
		}
	}
	// Complete-utterance matching: greeting prefixes cannot swallow a real question.
	// Work is bounded even for a malformed or unusually long transcript.
	if len([]rune(value)) > 80 {
		return true
	}
	reachable := make([]bool, len(value)+1)
	reachable[0] = true
	for i := range value {
		if !reachable[i] {
			continue
		}
		for _, word := range rules.AcknowledgementKeywords {
			token := openingCompact(word)
			if token != "" && strings.HasPrefix(value[i:], token) {
				reachable[i+len(token)] = true
			}
		}
	}
	return !reachable[len(value)]
}

// Only substantive turns enter this buffer. Acknowledgements remain ordinary
// transcript evidence and never become questions to answer after the opening.
type pendingOpeningSpeech struct {
	turns      []string
	characters int
}

func (p *pendingOpeningSpeech) empty() bool { return len(p.turns) == 0 }
func (p *pendingOpeningSpeech) add(text string) {
	text = strings.TrimSpace(text)
	if text == "" || (len(p.turns) > 0 && p.turns[len(p.turns)-1] == text) {
		return
	}
	remaining := 6000 - p.characters
	if remaining <= 0 {
		return
	}
	runes := []rune(text)
	if len(runes) > remaining {
		runes = runes[:remaining]
	}
	p.turns = append(p.turns, string(runes))
	p.characters += len(runes)
}
func (p *pendingOpeningSpeech) take() string {
	text := strings.Join(p.turns, "；")
	p.turns = nil
	p.characters = 0
	return text
}
