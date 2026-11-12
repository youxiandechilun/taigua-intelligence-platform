// 中文导读：既有验证代码：对模型回复进行业务检查，并决定是否修正、放行或结束。
package main

import (
	"strings"
	"testing"
)

func TestReplyReviewDiscardsUnheardCandidateBeforeNextCustomerAnswer(t *testing.T) {
	d := &dialogueRuntime{}
	d.customer("在哪里看？")
	r := reviewBotReply(d, "方便加您微信吗？您直接说好的，我就知道您同意了。", true, 1)
	if !r.Intercepted || !r.CommunicationRepair || r.RecoveryHint == "" {
		t.Fatal("unsafe reply was not reviewed with a recovery direction")
	}
	resolveBotReply(d, r, false)
	if d.stream != "" || len(d.questions) != 0 || len(d.turns) != 1 {
		t.Fatal("rejected candidate became telephone history")
	}
	if r.RecoveryHint == "" {
		t.Fatal("discard erased recovery direction")
	}
	d.customer("可以")
	if d.followUp != "" {
		t.Fatal("customer answer used an unheard rejected invitation")
	}
	late := reviewBotReply(d, "方便加您微信吗？", true, 1)
	if !late.Ignored || late.Intercepted || resolveBotReply(d, late, false) {
		t.Fatal("late rejected text caused a second action")
	}
}

func TestReplyReviewPreservesNormalInvitationPricingAndClosing(t *testing.T) {
	d := &dialogueRuntime{}
	d.customer("在哪里看？")
	offer := reviewBotReply(d, "在微信里看。方便的话，我加您微信，把直播间发您。", true, 1)
	if offer.Intercepted || !resolveBotReply(d, offer, true) {
		t.Fatal("normal offer was changed")
	}
	d.customer("要不要收费？")
	price := reviewBotReply(d, "观看直播不收费。", true, 2)
	if price.Intercepted || !resolveBotReply(d, price, true) {
		t.Fatal("clear pricing answer was changed")
	}
	d.customer("好，那你加我。")
	closing := reviewBotReply(d, "好，那我稍后加您微信，把直播间发您，再见。", true, 3)
	if d.followUp != "wechat" || !closing.Closing || closing.Intercepted || !resolveBotReply(d, closing, true) {
		t.Fatal("normal consent/closing was blocked")
	}
	n := len(d.turns)
	duplicate := reviewBotReply(d, "好，那我稍后加您微信，把直播间发您，再见。", true, 3)
	if !duplicate.Ignored || resolveBotReply(d, duplicate, true) || len(d.turns) != n {
		t.Fatal("duplicate final changed conversation state")
	}
}

func TestReplyReviewRetainsPossiblePartialAudioWithoutClaimingCompleteOpening(t *testing.T) {
	for _, audio := range []bool{false, true} {
		d := &dialogueRuntime{opening: "您好，我是小程，想邀请您看直播。"}
		partial := reviewBotReply(d, "方便加您微信吗", false, 1)
		if partial.Intercepted {
			t.Fatal("normal partial invitation was blocked")
		}
		if resolveBotReply(d, partial, audio) {
			t.Fatal("partial text was committed as a complete reply")
		}
		if audio {
			d.preserveBotContext(1)
		}
		d.customer("可以")
		if (d.followUp == "wechat") != audio {
			t.Fatalf("possible audio context mismatch: audio=%v", audio)
		}
		if d.openingComplete || len(d.questions) != 0 {
			t.Fatal("partial reply pretended complete playback or a final question")
		}
	}
}

func TestReplyReviewKeepsEnglishAnswerAndHonorsCustomerQuestion(t *testing.T) {
	d := &dialogueRuntime{language: "en"}
	d.customer("What does it cost?")
	r := reviewBotReply(d, "Watching the live session is free.", true, 1)
	if r.Intercepted || !resolveBotReply(d, r, true) || !strings.Contains(d.lastBotContext, "free") {
		t.Fatal("English answer lost approved context")
	}
	d.customer("When does it start?")
	ending := reviewBotReply(d, "Goodbye.", true, 2)
	if !ending.Premature || !ending.Intercepted {
		t.Fatal("unanswered question was prematurely closed")
	}
	resolveBotReply(d, ending, false)
	if d.lastBotContext != "Watching the live session is free." {
		t.Fatal("rejected farewell replaced last approved answer")
	}
}
