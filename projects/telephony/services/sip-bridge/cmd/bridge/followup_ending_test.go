// 中文导读：既有验证代码：微信跟进后的结束状态；需核对轮次、播放完成与客户说话状态，再决定告别或挂断。
package main

import (
	"strings"
	"testing"
)

func TestFollowUpClosingEventOrderAndInterruption(t *testing.T) {
	for _, order := range []string{"ftp", "tfp", "pft", "ptf", "fpt", "tpf"} {
		f := &followUpEnding{}
		for _, event := range order {
			switch event {
			case 'f':
				f.final(7)
			case 't':
				f.tool(7)
			case 'p':
				f.playback(7, true)
			}
		}
		if f.action(7, true, true) != 1 {
			t.Fatalf("farewell didn't finish exactly once in order %s", order)
		}
		f.cancel(7)
		f.final(7)
		f.tool(7)
		if f.action(7, true, true) != 0 {
			t.Fatal("late final/tool revived cancelled farewell")
		}
		f.final(8)
		f.playback(8, true)
		if f.action(8, false, true) != 0 {
			t.Fatal("new customer question was cut off")
		}
		if f.action(8, true, true) != 1 {
			t.Fatal("later valid farewell permanently blocked")
		}
	}
}
func TestFollowUpClosingWaitsForAudioAndSupplementsOnlyOnce(t *testing.T) {
	f := &followUpEnding{}
	f.final(7)
	f.tool(7)
	if f.action(7, true, true) != 0 {
		t.Fatal("hangup before audible playback")
	}
	f.playback(7, true)
	if f.action(7, true, false) != 2 {
		t.Fatal("missing goodbye wasn't supplemented")
	}
	f.pending, f.requested = 8, true
	f.final(8)
	f.playback(8, true)
	if f.action(8, true, false) != 0 {
		t.Fatal("missing goodbye loops")
	}
	if f.action(8, true, true) != 1 {
		t.Fatal("supplemented goodbye can't finish")
	}
	g := &followUpEnding{}
	g.tool(7)
	g.playback(7, false)
	if g.action(7, true, false) != 3 {
		t.Fatal("tool-only response stranded caller")
	}
}
func TestSilenceIsNotRecognitionFailure(t *testing.T) {
	for _, lang := range []string{"zh", "en"} {
		for _, n := range []int{1, 2} {
			text := silenceCheckLine(lang, n)
			if strings.Contains(text, "没听清") || strings.Contains(text, "catch") {
				t.Fatal("silence fabricated a failed utterance")
			}
		}
	}
}
