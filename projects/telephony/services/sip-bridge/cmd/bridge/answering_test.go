// 中文导读：既有验证代码：接听与通话开始阶段的辅助处理。
package main

import (
	"testing"
	"time"
)

func TestAnsweringAnnouncements(t *testing.T) {
	for _, v := range []string{"通话已转至语音留言，你尝试联系的用户无法接听。", "您好，我是机主的智能助手，现在为他代接电话。", "你好，我是小爱，帮主人接听电话。", "请在提示音后录制留言，完成后挂断即可。", "您好，这里是语音信箱。", "Your call has been forwarded to voicemail."} {
		if !answeringMachineAnnouncement(v) {
			t.Errorf("missed %q", v)
		}
	}
	for _, v := range []string{"", "你好", "你是语音助手吗", "我不想用语音助手", "刚才是小爱代接，现在是我本人", "他说通话已转至语音留言", "我是张先生，有什么事", "我是做智能助手产品的", "我刚才听见通话已转至语音留言", "请问您找谁", "我不方便接听"} {
		if answeringMachineAnnouncement(v) {
			t.Errorf("false hangup %q", v)
		}
	}
}
func TestAnsweringPartialBoundary(t *testing.T) {
	s := answeringTranscript{}
	if answeringMachineAnnouncement(s.add("通话已转至", false)) {
		t.Fatal("incomplete announcement")
	}
	if !answeringMachineAnnouncement(s.add("语音留言", false)) {
		t.Fatal("partial detection failed")
	}
	s.add("普通客户回答", true)
	if s.add("您好", false) != "您好" {
		t.Fatal("turn leaked")
	}
}

func TestRecordedAnnouncementWithMissingCallPrefix(t *testing.T) {
	for _, text := range []string{
		"已转至语音留言，你尝试联系的用户无法接听，请在提示音后录制留言，录音完成后挂断即可。",
		"您好，已转入语音留言。",
		"你尝试联系的用户无法接听，请在提示音后留言。",
	} {
		if !answeringMachineAnnouncement(text) {
			t.Fatalf("recorded assistant missed: %s", text)
		}
	}
	for _, text := range []string{"刚才提示已转至语音留言，现在是我本人接。", "他说已转入语音留言。", "你怎么知道我无法接听？", "我没转至语音留言"} {
		if answeringMachineAnnouncement(text) {
			t.Fatalf("human speech mistaken for assistant: %s", text)
		}
	}
	s := answeringTranscript{}
	if answeringMachineAnnouncement(s.add("已转至", false)) {
		t.Fatal("incomplete announcement matched")
	}
	if !answeringMachineAnnouncement(s.add("语音留言", false)) {
		t.Fatal("announcement split across deltas missed")
	}
}

func TestExplicitOwnerProxyDuties(t *testing.T) {
	for _, text := range []string{
		"您好，我是机主的智能助手，帮机主接听电话。",
		"这里是小爱，替主人接听电话。",
		"我这边是小布，为机主接听来电。",
		"您拨打的电话暂时无法接听，您好，我是机主的智能助手，帮机主接听电话。",
	} {
		if !answeringMachineAnnouncement(text) {
			t.Errorf("explicit proxy missed: %q", text)
		}
		if !groundedAnsweringEvidence(text, text) {
			t.Errorf("grounded proxy tool rejected: %q", text)
		}
	}
	for _, text := range []string{
		"我是做智能助手产品的销售，有什么事？",
		"我是智能助手产品的销售，有什么事？",
		"这里是智能助手开发公司，请问您找谁？",
		"我刚才让小爱替主人接听电话，现在是我本人。",
		"他说我是机主的智能助手，帮机主接听电话。",
		"你是智能助手，替主人接听电话的吗？",
		"我是张先生，我的智能助手帮机主接听电话。",
	} {
		if answeringMachineAnnouncement(text) {
			t.Errorf("human speech mistaken for proxy: %q", text)
		}
	}
	if groundedAnsweringEvidence("这里是小爱，替主人接听电话。", "您好，我本人接的，有什么事？") {
		t.Fatal("ungrounded model evidence accepted")
	}
}

func TestAnsweringIdentitySplitAcrossFinalTranscripts(t *testing.T) {
	s := answeringTranscript{}
	if answeringMachineAnnouncement(s.add("您好，我是小布。", true)) {
		t.Fatal("bare ambiguous name should wait for an answering duty")
	}
	combined := s.add("现在替机主接听电话。", true)
	if !answeringMachineAnnouncement(combined) {
		t.Fatal("explicit identity and answering duty split across finals were missed")
	}
	if !groundedAnsweringEvidence(combined, "您好，我是小布。现在替机主接听电话。") {
		t.Fatal("actual cross-final evidence was rejected")
	}
	if groundedAnsweringEvidence(combined, "您好，我是本人接听。") {
		t.Fatal("invented cross-final evidence was accepted")
	}
	for _, human := range []string{"我是小布产品的销售。", "他说我是小布。", "你是小布吗？", "我是张先生。"} {
		s = answeringTranscript{}
		s.add(human, true)
		if answeringMachineAnnouncement(s.add("我会帮机主转达。", true)) {
			t.Fatalf("human context was joined into an assistant: %q", human)
		}
	}
	s = answeringTranscript{}
	s.add("我是小布。", true)
	s.pendingAt = time.Now().Add(-6 * time.Second)
	if answeringMachineAnnouncement(s.add("替机主接听电话。", true)) {
		t.Fatal("stale identity leaked into a later conversation")
	}
}
