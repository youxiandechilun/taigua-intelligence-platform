// 中文导读：从系统配置读取固定话术，用于对话过程中的系统回复。
package main

import "strings"

// Missing or blank values keep the legacy line.
type systemSpeechLanguage struct {
	NoResponseFirst    *string `json:"noResponseFirst"`
	NoResponseSecond   *string `json:"noResponseSecond"`
	NoResponseEnd      *string `json:"noResponseEnd"`
	Unclear            *string `json:"unclear"`
	Declined           *string `json:"declined"`
	FollowUp           *string `json:"followUp"`
	Goodbye            *string `json:"goodbye"`
	HandoffStart       *string `json:"handoffStart"`
	HandoffUnavailable *string `json:"handoffUnavailable"`
	AudioCheck         *string `json:"audioCheck"`
}
type systemSpeech struct {
	ZH *systemSpeechLanguage `json:"zh"`
	EN *systemSpeechLanguage `json:"en"`
}

func (s *systemSpeech) configured(language, key string) (string, bool) {
	var config *systemSpeechLanguage
	if s != nil {
		if strings.HasPrefix(strings.ToLower(language), "en") {
			config = s.EN
		} else {
			config = s.ZH
		}
	}
	var value *string
	if config != nil {
		switch key {
		case "noResponseFirst":
			value = config.NoResponseFirst
		case "noResponseSecond":
			value = config.NoResponseSecond
		case "noResponseEnd":
			value = config.NoResponseEnd
		case "unclear":
			value = config.Unclear
		case "declined":
			value = config.Declined
		case "followUp":
			value = config.FollowUp
		case "goodbye":
			value = config.Goodbye
		case "handoffStart":
			value = config.HandoffStart
		case "handoffUnavailable":
			value = config.HandoffUnavailable
		case "audioCheck":
			value = config.AudioCheck
		}
	}
	if value != nil && strings.TrimSpace(*value) != "" {
		return strings.TrimSpace(*value), true
	}
	return "", false
}

func (s *systemSpeech) line(language, key string) string {
	if value, ok := s.configured(language, key); ok {
		return value
	}
	switch key {
	case "noResponseFirst":
		return silenceCheckLine(language, 1)
	case "noResponseSecond":
		return silenceCheckLine(language, 2)
	case "noResponseEnd":
		return conversationLine(language, "暂时没听到您的回复，先不打扰您了，再见。", "I haven't heard a reply, so I'll let you go for now. Goodbye.")
	case "unclear":
		return conversationLine(language, "刚才没听清，麻烦您再说一下。", "Sorry, I didn't catch that. Could you repeat it?")
	case "declined":
		return conversationLine(language, "好，不打扰您了，再见。", "Of course. I'll let you go. Goodbye.")
	case "followUp":
		return conversationLine(language, "好的，我这边挂断后加您微信，谢谢，再见。", "Okay, I'll follow up with you on WeChat after the call. Goodbye.")
	case "goodbye":
		return conversationLine(language, "再见。", "Goodbye.")
	case "handoffStart":
		return conversationLine(language, "请稍等，我联系一下在岗同事。", "Please hold while I contact an available colleague.")
	case "handoffUnavailable":
		return conversationLine(language, "现在同事暂时没接通，我会安排同事跟进。先不打扰您了，再见。", "My colleague isn't available right now. I'll arrange a follow-up. Thank you, and goodbye.")
	default:
		return ""
	}
}
