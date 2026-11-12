// 中文导读：既有验证代码：客户接受邀约后的业务收尾判断。
package main

import "testing"

const acceptedOpeningInvitation = "今晚有一场线上直播，七点到七点半，您看看有时间了解一下吗？我加您微信把资料发您。"

func TestAcceptedInvitationClosesWithoutAnotherQuestion(t *testing.T) {
	for _, answer := range []string{"好", "好的", "可以啊", "嗯，可以的", "好，了解一下吗？", "好的，了解一下", "可以，了解一下吧"} {
		t.Run(answer, func(t *testing.T) {
			d := &dialogueRuntime{language: "zh"}
			d.acceptedBot(acceptedOpeningInvitation, true, 1)
			if d.customer(answer) || !d.acceptedFollowUpReady() || d.followUp != "wechat" {
				t.Fatalf("accepted current invitation did not reach closing: %+v", d)
			}
			if got := matchIntentRules(answer, []intentRule{{ID: "workspace-rule", Intent: "interested", Enabled: true, Keywords: []string{"好", "可以"}, ApplyTo: []string{"outbound"}}}, "outbound", acceptedOpeningInvitation); got == nil || got.Intent != "interested" || got.Evidence != answer {
				t.Fatalf("configured contextual intent was lost: %+v", got)
			}
		})
	}
	d := &dialogueRuntime{}
	d.acceptedBot("您有时间了解一下我们的产品吗？", true, 1)
	d.customer("好的，了解一下")
	if !d.acceptedFollowUpReady() || d.followUp != "" {
		t.Fatal("business acceptance must close without inventing a WeChat request")
	}
}

func TestAcceptedInvitationRejectsUnrelatedAndQualifiedReplies(t *testing.T) {
	for _, answer := range []string{"嗯", "你好", "好，但是收费吗", "好，怎么了解？", "好，看看价格吗？", "好，了解一下你是谁？", "我同事说好", "他说可以了解一下", "如果免费就好", "可以啊？", "好的，不用加我", "好，了解一下不了", "好，了解一下，但是没时间", "“好，了解一下吗？”", "好，我这边听到了", "听不到"} {
		t.Run(answer, func(t *testing.T) {
			d := &dialogueRuntime{}
			d.acceptedBot(acceptedOpeningInvitation, true, 1)
			d.customer(answer)
			if d.acceptedFollowUpReady() {
				t.Fatal("non-acceptance committed an ending")
			}
		})
	}
	for _, previous := range []string{"您能听到吗？", "今晚有线上直播，您是哪家公司的？", "今晚有直播。您了解一下。", "您有时间了解一下吗？我加您微信把资料发您，您做什么行业？"} {
		if acceptedBusinessInvitation("好，了解一下吗？", previous) {
			t.Fatalf("unrelated final question or non-invitation accepted: %s", previous)
		}
	}
}

func TestAcceptedInvitationRequiresHeardFreshContextAndScopedRule(t *testing.T) {
	for _, mode := range []string{"missing", "unheard", "consumed", "late-final"} {
		d := &dialogueRuntime{}
		if mode == "unheard" {
			d.bot(acceptedOpeningInvitation, true, 1)
			d.rejectUnheardBot(1)
		} else if mode == "consumed" || mode == "late-final" {
			d.acceptedBot(acceptedOpeningInvitation, true, 1)
			d.customer("收费吗？")
			if mode == "late-final" {
				d.bot(acceptedOpeningInvitation, true, 1)
				d.acceptBot(1)
			}
		}
		d.customer("好，了解一下吗？")
		if d.acceptedFollowUpReady() {
			t.Fatalf("reused %s invitation", mode)
		}
	}
	for _, rule := range []intentRule{
		{ID: "disabled", Intent: "interested", Enabled: false, Keywords: []string{"好"}},
		{ID: "other-scope", Intent: "interested", Enabled: true, Keywords: []string{"好"}, ApplyTo: []string{"demo"}},
		{ID: "no-keyword", Intent: "interested", Enabled: true, Keywords: []string{"报价"}},
		{ID: "negative", Intent: "interested", Enabled: true, Keywords: []string{"好"}, NegativeKeywords: []string{"了解一下"}},
	} {
		if matchIntentRules("好，了解一下吗？", []intentRule{rule}, "outbound", acceptedOpeningInvitation) != nil {
			t.Fatalf("bypassed configured rule: %s", rule.ID)
		}
	}
}
