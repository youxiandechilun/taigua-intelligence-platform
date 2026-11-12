// 中文导读：既有验证代码：从系统配置读取固定话术，用于对话过程中的系统回复。
package main

import (
	"strings"
	"testing"
)

func TestSystemSpeechFallbackAndOverrides(t *testing.T) {
	custom, blank := "  自定义结束语  ", ""
	var legacy *systemSpeech
	if got := legacy.line("zh", "declined"); got != "好，不打扰您了，再见。" {
		t.Fatalf("legacy Chinese = %q", got)
	}
	if got := legacy.line("en-US", "goodbye"); got != "Goodbye." {
		t.Fatalf("legacy English = %q", got)
	}
	config := &systemSpeech{ZH: &systemSpeechLanguage{Declined: &custom, Goodbye: &blank}}
	if got := config.line("zh", "declined"); got != "自定义结束语" {
		t.Fatalf("custom = %q", got)
	}
	if got := config.line("zh", "goodbye"); got != "再见。" {
		t.Fatalf("blank fallback = %q", got)
	}
	if got := config.line("zh", "noResponseSecond"); got != silenceCheckLine("zh", 2) {
		t.Fatalf("missing field = %q", got)
	}
	if got := config.line("en", "goodbye"); got != "Goodbye." {
		t.Fatalf("missing language = %q", got)
	}
}

func TestSystemSpeechReachesConversationHints(t *testing.T) {
	followUp, audioCheck := "稍后联系您，再见。", "现在可以听清吗？"
	d := &dialogueRuntime{language: "zh", followUpFocused: true, followUp: "wechat", systemSpeech: &systemSpeech{ZH: &systemSpeechLanguage{FollowUp: &followUp, AudioCheck: &audioCheck}}}
	if hint := d.followUpHint(); !strings.Contains(hint, followUp) || strings.Contains(hint, "好的，我这边挂断后加您微信") {
		t.Fatalf("follow-up hint = %q", hint)
	}
	d.audioIssue = true
	if hint := d.communicationHint(); !strings.Contains(hint, audioCheck) {
		t.Fatalf("audio hint = %q", hint)
	}
	if policy := dialoguePolicyFor(d.systemSpeech, d.language); !strings.Contains(policy, audioCheck) || strings.Contains(policy, "我在，您现在能听到吗？") {
		t.Fatalf("audio policy = %q", policy)
	}
	if dialoguePolicyFor(nil, "zh") != dialoguePolicy {
		t.Fatal("legacy policy changed")
	}
	legacy := &dialogueRuntime{language: "zh", followUp: "wechat"}
	if hint := legacy.followUpHint(); !strings.Contains(hint, "好的，我这边挂断后加您微信") {
		t.Fatalf("legacy follow-up hint = %q", hint)
	}
}
