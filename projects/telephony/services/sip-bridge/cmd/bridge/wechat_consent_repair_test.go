// 中文导读：既有验证代码：wechat_consent_repair_test 的输入、输出及边界场景。
package main

import "testing"

const actualWeChatOffer = "在微信上面看呀。方便的话，我加您微信把直播间发您。"

func TestNaturalWeChatConsentReachesAudibleFarewell(t *testing.T) {
	for _, answer := range []string{"可以啊，你加我啊。", "可以啊。", "方便的。", "好呀，你加我吧", "嗯，可以的", "方便啊"} {
		t.Run(answer, func(t *testing.T) {
			d := &dialogueRuntime{language: "zh"}
			d.customer("在哪里看啊？")
			offer := reviewBotReply(d, actualWeChatOffer, true, 1)
			if offer.Intercepted || !resolveBotReply(d, offer, true) {
				t.Fatal("natural invitation was not accepted")
			}
			d.customer(answer)
			if d.followUp != "wechat" || !d.followUpFocused || d.audioIssue {
				t.Fatalf("clear contextual consent was lost: followUp=%q focused=%v audioIssue=%v", d.followUp, d.followUpFocused, d.audioIssue)
			}
			closing := reviewBotReply(d, "好的，我这边挂断后加您微信，把直播间发您，谢谢，再见。", true, 2)
			if closing.Intercepted || !closing.Closing || !resolveBotReply(d, closing, true) {
				t.Fatalf("normal farewell was blocked: %+v", closing)
			}
			f := &followUpEnding{}
			if !f.observeReply(d, closing) || f.resolve(d, 2, false, false, false) != 0 {
				t.Fatal("text without playback must wait")
			}
			f.playback(2, false)
			if f.resolve(d, 2, false, false, false) != 0 {
				t.Fatal("silent turn ended the call")
			}
			f.playback(2, true)
			if f.resolve(d, 2, false, true, false) != 0 || f.resolve(d, 2, false, false, true) != 0 {
				t.Fatal("customer speech or recognition was bypassed")
			}
			if f.resolve(d, 2, false, false, false) != 1 {
				t.Fatal("audible farewell did not finish the call")
			}
		})
	}
}

func TestNaturalWeChatConsentRejectsNonAgreement(t *testing.T) {
	for _, answer := range []string{"不方便的", "可以啊？", "方便吗", "可以啊，但是收费吗", "如果免费你加我", "我朋友说可以啊", "可以啊，你加我同事", "我没说你加我", "你加我干什么", "不要加我", "低着头", "嗯"} {
		t.Run(answer, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.acceptedBot(actualWeChatOffer, true, 1)
			d.customer(answer)
			if d.followUp != "" || d.followUpFocused {
				t.Fatal("ambiguous, conditional, third-party or negative answer became consent")
			}
		})
	}
}

func TestShortWeChatConsentNeedsCurrentInvitation(t *testing.T) {
	for _, answer := range []string{"可以啊", "方便的", "好的"} {
		for _, mode := range []string{"none", "unheard", "other-question", "other-statement", "consumed", "price-answer"} {
			t.Run(answer+"/"+mode, func(t *testing.T) {
				d := &dialogueRuntime{}
				switch mode {
				case "unheard":
					d.bot(actualWeChatOffer, true, 1)
					d.rejectUnheardBot(1)
				case "other-question":
					d.acceptedBot("方便的话，我加您微信，您是做什么行业的？", true, 1)
				case "other-statement":
					d.acceptedBot("方便的话，我加您微信，您先介绍一下公司。", true, 1)
				case "consumed", "price-answer":
					d.acceptedBot("方便加您微信吗？", true, 1)
					d.customer("收费吗？")
					if mode == "price-answer" {
						d.acceptedBot("观看免费。", true, 2)
					}
				}
				d.customer(answer)
				if d.followUp != "" {
					t.Fatal("short answer reused missing, unheard, unrelated or already-answered invitation")
				}
			})
		}
	}
}

func TestNaturalWeChatConsentCannotClearHearingIssue(t *testing.T) {
	d := &dialogueRuntime{}
	d.customer("听不到")
	d.acceptedBot("我在，您现在能听到吗？", true, 1)
	d.customer("方便的")
	if !d.audioIssue || d.followUp != "" {
		t.Fatal("availability was treated as recovered hearing or WeChat consent")
	}
}

func TestWeChatConsentHandlesOfferClausePunctuation(t *testing.T) {
	for _, offer := range []string{actualWeChatOffer, "在微信里看。方便的话，我加您微信，把直播间发您。", "方便的话，我加您微信，把资料发给您。", "我加您微信，方便吗？", "方便加您微信吗？"} {
		t.Run(offer, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.acceptedBot(offer, true, 1)
			d.customer("可以啊")
			if d.followUp != "wechat" {
				t.Fatal("clause punctuation prevented consent to the current invitation")
			}
		})
	}
}

func TestNaturalWeChatConsentStillHonorsNewCustomerInput(t *testing.T) {
	for _, customer := range []string{"几点开始？", "先别挂，我还有个问题", "我换一个微信", "不要加我了", "我听不到"} {
		t.Run(customer, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.acceptedBot(actualWeChatOffer, true, 1)
			d.customer("可以啊，你加我啊")
			r := reviewBotReply(d, "好的，我挂断后加您微信，再见。", true, 2)
			resolveBotReply(d, r, true)
			f := &followUpEnding{}
			f.observeReply(d, r)
			f.cancel(2)
			d.customer(customer)
			f.playback(2, true)
			if f.resolve(d, 2, false, false, false) != 0 {
				t.Fatal("the old farewell ended a reopened conversation")
			}
			if customer == "我换一个微信" && !d.followUpOtherPending {
				t.Fatal("a replacement contact was not requested")
			}
		})
	}
}

func TestLateInvitationFinalCannotReuseAnAnsweredOffer(t *testing.T) {
	d := &dialogueRuntime{}
	d.bot("方便加您微信吗？", false, 1)
	d.preserveBotContext(1) // Some invitation audio was queued before interruption.
	d.customer("收费吗？")
	d.bot("方便加您微信吗？", true, 1) // Late final from that same response.
	d.acceptBot(1)
	d.customer("可以啊")
	if d.followUp != "" {
		t.Fatal("late final revived a consumed invitation")
	}
	d.acceptedBot("观看免费，方便加您微信吗？", true, 2)
	d.customer("方便的")
	if d.followUp != "wechat" {
		t.Fatal("a new invitation could not get its own answer")
	}
}

func TestReplyReviewReportsSpecificCommunicationReason(t *testing.T) {
	for _, tc := range []struct{ customer, reply, want string }{
		{"在哪里看", "好的，我加您微信。", "unconfirmed_followup"},
		{"在哪里看", "您直接说好的，我就知道您同意了。", "internal_rule_coaching"},
		{"听不到", "方便加您微信吗？", "audio_issue_followup"},
		{"听不到", "再见。", "audio_issue_early_closing"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.customer(tc.customer)
			r := reviewBotReply(d, tc.reply, true, 1)
			if !r.Intercepted || r.CommunicationReason != tc.want {
				t.Fatalf("missing specific rejection reason: %+v", r)
			}
			resolveBotReply(d, r, false)
			r = reviewBotReply(d, "我在，您现在能听到吗？", true, 2)
			if r.CommunicationRepair || r.CommunicationReason != "" {
				t.Fatal("previous rejection reason leaked into a new valid reply")
			}
		})
	}
}
