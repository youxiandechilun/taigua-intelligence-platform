// 中文导读：既有验证代码：dialogue_candidate_test 的输入、输出及边界场景。
package main

import (
	"fmt"
	"strings"
	"testing"
)

func TestObservedReplyDoesNotCommitTelephoneContext(t *testing.T) {
	d := &dialogueRuntime{opening: "您好，我是小程，想邀请您看直播。", audioIssue: true}
	d.bot("我是小程，想邀请您看直播。候选独有内容，您现在能听到我说话吗？方便加您微信吗？", true, 2)
	if len(d.turns) != 0 || len(d.questions) != 0 || d.wechatContextTurns != 0 || d.audioCheckAttempted || len(d.openingPlayback) != 0 {
		t.Fatal("unapproved model draft was committed as telephone context")
	}
	d.customer("好，那你加我")
	if d.followUp != "" {
		t.Fatal("unapproved invitation authorized follow-up")
	}
	if strings.Contains(d.instructions("", nil), "候选独有内容") {
		t.Fatal("unapproved draft was recycled into recent telephone history")
	}
}

func TestRejectedUnheardDraftDoesNotReplacePriorContext(t *testing.T) {
	d := &dialogueRuntime{opening: "您好，我是小程，想邀请您看直播。"}
	d.acceptedBot("您好，我是小程。", true, 1)
	before := d.turns[0]["text"]
	d.customer("在哪里看？")
	d.bot("候选独有内容，方便加您微信吗？", true, 2)
	d.redirectedTurn, d.communicationBlockedTurn = 2, 2
	if !d.rejectUnheardBot(2) || d.rejectUnheardBot(2) {
		t.Fatal("rejection is not idempotent")
	}
	if d.lastBotContext != before || len(d.turns) != 2 || len(d.questions) != 0 || d.wechatContextTurns != 0 || len(d.openingPlayback) != 1 {
		t.Fatal("unheard rejection changed accepted context or committed draft side effects")
	}
	if d.redirectedTurn != 2 || d.communicationBlockedTurn != 2 {
		t.Fatal("rejection erased guard decisions")
	}
	if !d.ignoreBotTurn(2) || !d.isRejectedBotTurn(2) {
		t.Fatal("late rejected final would be reviewed again")
	}
	d.bot("候选独有内容，方便加您微信吗？", true, 2)
	if d.acceptBot(2) {
		t.Fatal("rejected final revived the same reply")
	}
	d.customer("可以")
	if d.followUp != "" || strings.Contains(d.instructions("", nil), "候选独有内容") {
		t.Fatal("rejected invitation polluted customer consent or model history")
	}
}

func TestUnheardAudibilityCheckDoesNotExhaustRepair(t *testing.T) {
	d := &dialogueRuntime{}
	d.acceptedBot("您好。", true, 1)
	d.customer("听不到声音")
	d.bot("我在，您现在能听到我说话吗？", true, 2)
	d.rejectUnheardBot(2)
	d.customer("没有")
	if d.audioCheckAttempted || d.communicationExhausted() || d.audioRepairFailed {
		t.Fatal("unheard hearing check exhausted repair")
	}
	d.bot("我在，您现在能听到我说话吗？", true, 3)
	d.acceptBot(3)
	d.customer("没有")
	if !d.audioCheckAttempted || !d.communicationExhausted() {
		t.Fatal("approved hearing check lost existing failure behavior")
	}
}

func TestUnheardRejectedQuestionIsNotAlreadyAsked(t *testing.T) {
	d := &dialogueRuntime{}
	question := "您公司主要做什么产品，目前有开展出口业务吗？"
	d.bot(question, true, 1)
	d.rejectUnheardBot(1)
	if d.bot(question, true, 2) {
		t.Fatal("unheard rejected question was counted as already asked")
	}
	if !d.acceptBot(2) || d.acceptBot(2) || len(d.questions) != 1 || len(d.turns) != 1 {
		t.Fatal("approved final was not committed exactly once")
	}
	if !d.ignoreBotTurn(2) {
		t.Fatal("duplicate approved final would be reviewed twice")
	}
}

func TestApprovedReplyKeepsFollowUpAndOpeningEvidence(t *testing.T) {
	d := &dialogueRuntime{opening: "您好，我是小程，想邀请您看直播。"}
	d.bot("我是小程，想邀请您看直播。方便加您微信吗？", true, 1)
	if !d.acceptBot(1) {
		t.Fatal("approved reply did not commit")
	}
	if d.lastBotContext == "" || d.wechatContextTurns != 4 || len(d.questions) != 1 || len(d.openingPlayback) != 1 {
		t.Fatal("approved reply lost context evidence")
	}
	if d.openingComplete {
		t.Fatal("approval pretended the whole introduction had played")
	}
	if !d.openingPlaybackDone(1, "", true) || !d.openingComplete {
		t.Fatal("full playback no longer completes introduction")
	}
	if d.rejectUnheardBot(1) {
		t.Fatal("unheard rejection erased an already accepted reply")
	}
	d.customer("可以")
	if d.followUp != "wechat" || !d.followUpFocused {
		t.Fatal("approved invitation no longer accepts contextual agreement")
	}
}

func TestNewerCandidateCannotBeOverwrittenByLateEvents(t *testing.T) {
	d := &dialogueRuntime{}
	d.bot("旧问题，方便加您微信吗？", true, 1)
	d.rejectUnheardBot(1)
	d.bot("观看直播不收费。", true, 2)
	if !d.ignoreBotTurn(1) {
		t.Fatal("stale transcript was not ignored")
	}
	d.bot("旧问题，方便加您微信吗？", true, 1)
	if d.streamTurn != 2 || d.stream != "观看直播不收费。" || !d.acceptBot(2) {
		t.Fatal("late event replaced the current response")
	}
}

func TestUnheardRejectionPreservesAcceptedInvitationAcrossQuestion(t *testing.T) {
	d := &dialogueRuntime{}
	d.acceptedBot("方便的话，我加您微信，把直播间发您。", true, 1)
	d.customer("要不要收费？")
	d.bot("您直接说好的，我就知道您同意了。", true, 2)
	if !d.communicationRepair() {
		t.Fatal("draft was not identified as a rule-coaching response")
	}
	hint := d.communicationHint()
	if hint == "" {
		t.Fatal("recovery hint was unavailable before discard")
	}
	d.rejectUnheardBot(2)
	d.acceptedBot("观看直播不收费。", true, 3)
	d.customer("好，那你加我")
	if d.followUp != "wechat" || !d.followUpFocused {
		t.Fatal("unheard rejection erased prior approved WeChat context")
	}
}

func TestUnheardDraftStateIsIsolatedBetweenCalls(t *testing.T) {
	for i := 0; i < 60; i++ {
		t.Run(fmt.Sprintf("employee-%d", i), func(t *testing.T) {
			t.Parallel()
			rejected, approved := &dialogueRuntime{}, &dialogueRuntime{}
			rejected.bot("方便加您微信吗？", true, 1)
			approved.bot("方便加您微信吗？", true, 1)
			rejected.rejectUnheardBot(1)
			approved.acceptBot(1)
			rejected.customer("可以")
			approved.customer("可以")
			if rejected.followUp != "" || approved.followUp != "wechat" {
				t.Fatal("reply decision contaminated another call")
			}
		})
	}
}

func TestPartiallyPlayedReplyKeepsContextWithoutCommittingFinal(t *testing.T) {
	audible, silent := &dialogueRuntime{}, &dialogueRuntime{}
	for _, d := range []*dialogueRuntime{audible, silent} {
		d.bot("方便加您微信吗？", false, 1)
	}
	// Only the audible call has a queued-audio receipt from its own session.
	if !audible.preserveBotContext(1) {
		t.Fatal("partial reply with audio evidence lost customer context")
	}
	if len(audible.turns) != 0 || len(audible.questions) != 0 || audible.wechatContextTurns != 0 || len(audible.openingPlayback) != 0 || audible.committedBotTurn != 0 {
		t.Fatal("partial playback was treated as a complete final response")
	}
	audible.customer("可以")
	silent.customer("可以")
	if audible.followUp != "wechat" || silent.followUp != "" {
		t.Fatal("partial-audio and zero-audio contexts were not distinguished")
	}
	audible.bot("方便加您微信吗？", true, 1)
	if !audible.acceptBot(1) || len(audible.questions) != 1 {
		t.Fatal("partial context prevented later final commit")
	}
}

func TestPartialContextCannotReviveRejectedOrStaleCandidates(t *testing.T) {
	d := &dialogueRuntime{}
	d.acceptedBot("观看直播不收费。", true, 1)
	previous := d.lastBotContext
	d.bot("方便加您微信吗？", false, 2)
	d.rejectUnheardBot(2)
	if d.preserveBotContext(2) || d.lastBotContext != previous {
		t.Fatal("rejected candidate regained follow-up context")
	}
	d.bot("可以在直播间观看。", false, 3)
	if d.preserveBotContext(2) || d.preserveBotContext(1) || d.lastBotContext != previous {
		t.Fatal("stale or committed response overwrote current context")
	}
	if !d.preserveBotContext(3) || d.lastBotContext != "可以在直播间观看。" {
		t.Fatal("current partial-audio receipt was ignored")
	}
}
