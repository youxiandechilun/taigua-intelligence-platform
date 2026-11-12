// 中文导读：既有验证代码：wechat_natural_hangup_test 的输入、输出及边界场景。
package main

import "testing"

func TestNaturalWeChatHandoffFromActualCall(t *testing.T) {
	d := &dialogueRuntime{language: "zh"}
	d.customer("在哪里看？")
	offer := reviewBotReply(d, "在微信上就能看，挺方便的。要不我加您个微信，把直播间链接发给您？", true, 1)
	if offer.Intercepted || !resolveBotReply(d, offer, true) {
		t.Fatalf("invitation not accepted: %+v", offer)
	}
	d.customer("可以啊，你加我。")
	if d.followUp != "wechat" || !d.followUpFocused {
		t.Fatalf("consent not recognized: %+v", d)
	}
	reply := reviewBotReply(d, "行，那我这就加您微信，把直播间链接发过去。", true, 2)
	if reply.Intercepted || !reply.Closing || !resolveBotReply(d, reply, true) {
		t.Fatalf("handoff did not enter closing: %+v", reply)
	}
	f := &followUpEnding{}
	if !f.observeReply(d, reply) || f.resolve(d, 2, false, false, false) != 0 {
		t.Fatal("must wait for the response audio")
	}
	f.playback(2, false)
	if f.resolve(d, 2, false, false, false) != 0 {
		t.Fatal("silent playback must not trigger a farewell")
	}
	f.playback(2, true)
	if f.resolve(d, 2, false, true, false) != 0 || f.resolve(d, 2, false, false, true) != 0 {
		t.Fatal("must wait for customer speech and recognition")
	}
	if f.resolve(d, 2, false, false, false) != 2 {
		t.Fatal("handoff should request the configured farewell")
	}
	// A separate farewell response still needs audible playback before hangup.
	f.pending, f.requested = 3, true
	goodbye := reviewBotReply(d, "谢谢，再见。", true, 3)
	if goodbye.Intercepted || !goodbye.Closing || !resolveBotReply(d, goodbye, true) || !f.observeReply(d, goodbye) {
		t.Fatalf("farewell not accepted: %+v", goodbye)
	}
	if f.resolve(d, 3, false, false, false) != 0 {
		t.Fatal("farewell text without playback must not hang up")
	}
	f.playback(3, false)
	if f.resolve(d, 3, false, false, false) != 0 {
		t.Fatal("silent farewell must not hang up")
	}
	f.playback(3, true)
	if f.resolve(d, 3, false, false, false) != 1 {
		t.Fatal("audible farewell did not arm the hangup")
	}
	// Any new customer input cancels the old ending.
	f.cancel(3)
	d.customer("先别挂，我还有个问题")
	if f.resolve(d, 3, false, false, false) != 0 {
		t.Fatal("interrupted farewell should not hang up")
	}
}

func TestNaturalWeChatOfferNeedsActualConsent(t *testing.T) {
	offer := "要不我加您个微信，把直播间链接发给您？"
	for _, customer := range []string{"不要加我", "如果免费你加我", "可以啊？", "可以，你加我同事", "可以，但几点开始？"} {
		t.Run(customer, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.acceptedBot(offer, true, 1)
			d.customer(customer)
			if d.followUpFocused {
				t.Fatalf("not a personal unconditional agreement: %q", customer)
			}
		})
	}
	for _, unrelated := range []string{"要不我加您个微信，您做什么行业？", "要不我加您个微信，课程几点开始？"} {
		t.Run(unrelated, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.acceptedBot(unrelated, true, 1)
			d.customer("可以")
			if d.followUpFocused {
				t.Fatal("answer to unrelated question became consent")
			}
		})
	}
}

func TestNegativeAndReportedInvitationsDoNotAuthorizeConsent(t *testing.T) {
	for _, offer := range []string{
		"不是我加您微信，把直播间链接发给您？",
		"我不是说我加您微信，可以吗？",
		"我没有说我加您微信，可以吗？",
		"别人说我加您微信，把直播间链接发给您？",
		"您说我加您微信，把资料发给您？",
		"他说‘我加您微信’，把资料发给您？",
	} {
		t.Run(offer, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.acceptedBot(offer, true, 1)
			d.customer("可以")
			if d.followUp == "wechat" || d.followUpFocused {
				t.Fatal("negation, quotation or reported speech became an invitation")
			}
		})
	}
}

func TestNaturalWeChatCompletionIsGuarded(t *testing.T) {
	for _, reply := range []string{"好，我这就加您微信", "行，我马上加您个微信", "好的，我稍后加您的微信", "我这就加您微信，不打扰您了", "没问题，我稍后加您的微信"} {
		t.Run(reply, func(t *testing.T) {
			d := &dialogueRuntime{followUp: "wechat", followUpFocused: true, stream: reply}
			if !d.followUpCompleted() {
				t.Fatal("personal add promise not recognized")
			}
		})
	}
	for _, reply := range []string{"我不会马上加您微信", "不要我加您微信", "别让我加您微信", "没问题，不过我不会加您微信", "不是我加您微信", "别人说我加您微信", "您说我加您微信", "如果可以，我这就加您微信", "我这就加您微信可以吗？", "他说‘我这就加您微信’", "我这就加您微信，您还有什么问题？"} {
		t.Run(reply, func(t *testing.T) {
			d := &dialogueRuntime{followUp: "wechat", followUpFocused: true, stream: reply}
			if d.followUpCompleted() {
				t.Fatal("negative, conditional, quoted or unfinished reply became completion")
			}
		})
	}
	for _, d := range []*dialogueRuntime{
		{followUpFocused: true, stream: "我这就加您微信"},
		{followUp: "wechat", stream: "我这就加您微信"},
		{followUp: "wechat", followUpFocused: true, followUpOtherPending: true, stream: "我这就加您微信"},
		{followUp: "wechat", followUpFocused: true, audioIssue: true, stream: "我这就加您微信"},
		{followUp: "wechat", followUpFocused: true, fragment: "等一下", stream: "我这就加您微信"},
	} {
		if d.followUpCompleted() {
			t.Fatal("unconfirmed or interrupted follow-up became completion")
		}
	}
}
