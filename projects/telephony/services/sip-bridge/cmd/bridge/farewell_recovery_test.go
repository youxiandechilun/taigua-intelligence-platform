// 中文导读：既有验证代码：farewell_recovery_test 的输入、输出及边界场景。
package main

import "testing"

func consentedFollowUp(t *testing.T) *dialogueRuntime {
	t.Helper()
	d := &dialogueRuntime{language: "zh"}
	d.customer("在哪里看？")
	invitation := reviewBotReply(d, "在微信里看，方便加您微信吗？", true, 1)
	if invitation.Intercepted || !resolveBotReply(d, invitation, true) {
		t.Fatal("could not deliver the normal WeChat invitation")
	}
	d.customer("可以啊")
	if d.followUp != "wechat" || !d.followUpFocused {
		t.Fatal("the actual customer agreement did not select WeChat")
	}
	return d
}

func TestFollowUpFarewellSurvivesDelayedSpeechStop(t *testing.T) {
	d := consentedFollowUp(t)
	promise := reviewBotReply(d, "行，那我加您微信，把直播间发给您。", true, 2)
	if !promise.Closing || !resolveBotReply(d, promise, true) {
		t.Fatal("valid spoken follow-up arrangement was rejected")
	}
	// The actual farewell is a separate model response. Its text and audio
	// can finish before the provider reports that the customer stopped.
	f := &followUpEnding{}
	farewell := reviewBotReply(d, "再见。", true, 3)
	if !farewell.Closing || !resolveBotReply(d, farewell, true) || !f.observeReply(d, farewell) {
		t.Fatal("valid farewell was not classified as follow-up closing")
	}
	f.playback(3, true)
	if action := f.resolve(d, 3, false, true, false); action != 0 {
		t.Fatalf("customer was cut off before speech stopped: action=%d", action)
	}
	if action := f.resolve(d, 3, false, false, false); action != 1 {
		t.Fatalf("completed farewell was lost when speech-stop arrived late: action=%d", action)
	}
}

func TestFollowUpFarewellWaitsForRecognitionAndPlayback(t *testing.T) {
	d := consentedFollowUp(t)
	f := &followUpEnding{}
	review := reviewBotReply(d, "好的，我稍后加您微信，再见。", true, 2)
	if !review.Closing || !resolveBotReply(d, review, true) || !f.observeReply(d, review) {
		t.Fatal("farewell was not observed while recognition was pending")
	}
	if f.resolve(d, 2, false, false, false) != 0 {
		t.Fatal("text-only farewell ended the call before playback")
	}
	f.playback(2, true)
	if f.resolve(d, 2, false, false, true) != 0 {
		t.Fatal("pending recognition was bypassed")
	}
	if f.resolve(d, 2, false, false, false) != 1 {
		t.Fatal("farewell was lost while waiting for recognition")
	}
}

func TestFollowUpDeferredFarewellIsCancelledByNewCustomerSpeech(t *testing.T) {
	for _, text := range []string{"几点开始？", "刚才没听清", "先别挂，我还有个问题"} {
		t.Run(text, func(t *testing.T) {
			d := consentedFollowUp(t)
			f := &followUpEnding{}
			review := reviewBotReply(d, "好的，我稍后加您微信，再见。", true, 2)
			resolveBotReply(d, review, true)
			f.observeReply(d, review)
			f.cancel(2) // SpeechStarted / BargeIn / CustomerSaid.
			d.customer(text)
			f.playback(2, true) // Late receipt of the abandoned farewell.
			f.final(2)
			f.tool(2)
			if f.resolve(d, 2, false, false, false) != 0 {
				t.Fatal("late closing event hung up on a new customer turn")
			}
		})
	}
}

func TestFollowUpDeferredFarewellRequiresItsOwnAudibleTurn(t *testing.T) {
	d := consentedFollowUp(t)
	f := &followUpEnding{}
	review := reviewBotReply(d, "好的，我稍后加您微信，再见。", true, 2)
	resolveBotReply(d, review, true)
	f.observeReply(d, review)
	for _, played := range []struct {
		turn  int
		audio bool
	}{{1, true}, {2, false}} {
		f.playback(played.turn, played.audio)
		if f.resolve(d, 2, false, false, false) != 0 {
			t.Fatal("missing audio or another turn triggered hangup")
		}
	}
	f.playback(2, true)
	if f.resolve(d, 3, false, false, false) != 0 || f.resolve(d, 2, true, false, false) != 0 {
		t.Fatal("a newer response or an already-armed ending was overridden")
	}
	otherCall := &followUpEnding{}
	if otherCall.resolve(d, 2, false, false, false) != 0 {
		t.Fatal("farewell state leaked to another call")
	}
	if f.resolve(d, 2, false, false, false) != 1 {
		t.Fatal("matching audible farewell could not complete")
	}
}
