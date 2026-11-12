// 中文导读：既有验证代码：单通电话的对话状态、开场进度、客户信息和后续联系语义判断。
package main

import (
	"fmt"
	"strings"
	"testing"

	"taigua/sip-bridge/internal/media"
	"taigua/sip-bridge/internal/provider"
)

func TestOpeningAcknowledgementDoesNotAdvanceBusiness(t *testing.T) {
	d := &dialogueRuntime{opening: "您好，我是公司顾问，想和您聊一下出海业务，现在方便吗？", openingTurn: 1}
	if d.customer("喂，你好。") {
		t.Fatal("a greeting is not an unfinished fragment")
	}
	if d.openingComplete || !d.resumeOpening() {
		t.Fatal("unfinished introduction must resume after a greeting")
	}
	d.openingResumeUsed = true // The orchestrator commits a successful resume request.
	if d.resumeOpening() {
		t.Fatal("a second acknowledgement must not replay the opening")
	}
	if !strings.Contains(d.instructions("", nil), "不能当作同意继续") {
		t.Fatal("missing acknowledgement policy")
	}
	d.customer("我们目前做五金出口")
	if d.openingComplete || d.resumeOpening() {
		t.Fatal("a business answer must not pretend the opening was heard")
	}
}

func TestShortNegativesAreValidAnswersAndDoNotEndTheCall(t *testing.T) {
	for _, text := range []string{"没有。", "没", "还没有", "不是", "不清楚", "不知道"} {
		d := &dialogueRuntime{}
		if d.customer(text) || !shortNegative(text) || explicitEnding(text) != "" {
			t.Fatalf("invalid classification: %s", text)
		}
		if !strings.Contains(d.instructions("", nil), "不因此告别或结束通话") {
			t.Fatal("short-answer context is missing")
		}
		d.acceptedBot("好的，不打扰您了，再见。", true, 2)
		if !d.prematureClosing() {
			t.Fatal("an unjustified goodbye must be intercepted")
		}
	}
}

func TestQuotedRefusalIsNotAnEndingRequest(t *testing.T) {
	for _, text := range []string{"我怎么说不方便，他就挂了呢。", "没有外贸，国内做得挺好", "你说不方便是什么意思？", "现在不方便吗？我有时间"} {
		if explicitEnding(text) != "" {
			t.Fatalf("must not terminate for: %s", text)
		}
	}
	if explicitEnding("不方便。") != "declined" || explicitEnding("不要再联系我") != "opt_out" {
		t.Fatal("explicit requests were missed")
	}
}

func TestFlowDoesNotAssumeTheOpeningWasHeard(t *testing.T) {
	f := newFlowRuntime(&flowGraph{Entry: "opening", Nodes: []flowNode{{ID: "opening", Kind: "opening"}}})
	if strings.Contains(f.instructions(), "开场已由系统播报") {
		t.Fatal("planned opening was treated as completed playback")
	}
}

func TestQuestionDoesNotPretendIntroductionWasHeard(t *testing.T) {
	d := &dialogueRuntime{opening: "您好，我是泰卦的小程，想邀请您看今晚的直播。", openingTurn: 1}
	d.customer("哪位？")
	if d.openingComplete {
		t.Fatal("a customer question incorrectly completed the unheard introduction")
	}
}

func TestIntroductionCommitsOnlyAfterAudiblePlayback(t *testing.T) {
	d := &dialogueRuntime{opening: "您好，我是泰卦的小程，想邀请您参加直播。", openingTurn: 1}
	d.acceptedBot(d.opening, true, 1)
	d.customer("哪位？")
	if d.openingComplete || d.openingIdentityHeard || d.openingPurposeHeard {
		t.Fatal("generated or interrupted text was treated as heard")
	}
	d.acceptedBot("我是泰卦的小程。", true, 2)
	if d.openingIdentityHeard {
		t.Fatal("text was committed before audio finished")
	}
	if !d.openingPlaybackDone(2, "", true) || !d.openingIdentityHeard || d.openingComplete {
		t.Fatal("spoken identity was not tracked independently")
	}
	d.customer("你好")
	if !d.resumeOpening() {
		t.Fatal("missing purpose must remain eligible for one brief repair")
	}
	hint := d.instructions("", nil)
	if !strings.Contains(hint, "身份已听到，不再次自我介绍") {
		t.Fatal("repair would repeat the identity already heard")
	}
	d.acceptedBot("想邀请您今晚参加直播。", true, 3)
	if !d.openingPlaybackDone(3, "", true) || !d.openingComplete {
		t.Fatal("completed spoken purpose must finish the minimal introduction")
	}
	if d.resumeOpening() || strings.Contains(d.instructions("", nil), "开场介绍尚未完整播放") {
		t.Fatal("completed introduction was scheduled again")
	}
}

func TestOpeningPlaybackRequiresContentAndAudio(t *testing.T) {
	d := &dialogueRuntime{opening: "您好，我是小程，想邀请您看直播。", openingTurn: 1}
	d.acceptedBot("您好，您说。", true, 2)
	if d.openingPlaybackDone(2, "", true) || d.openingComplete {
		t.Fatal("an unrelated reply was mistaken for an introduction")
	}
	if d.openingPlaybackDone(1, "", false) || d.openingComplete {
		t.Fatal("a text-only or tool turn was treated as audible")
	}
	if !d.openingPlaybackDone(4, "opening-recordings", true) || !d.openingComplete {
		t.Fatal("a fully played original recording was not recognized")
	}
	d.customer("哪位？")
	if !d.openingComplete {
		t.Fatal("a question erased the completed introduction")
	}
}

func TestOpeningRepairYieldsToEndingAndUnfinishedSpeech(t *testing.T) {
	for _, tc := range []struct{ language, text string }{
		{"zh", "不需要"}, {"zh", "不要再联系我"}, {"zh", "再见"}, {"zh", "你好，我是。"},
		{"en", "No thanks"}, {"en", "Don't call me again"}, {"en", "Goodbye"}, {"en", "Hello, I'm..."},
	} {
		d := &dialogueRuntime{opening: "Hello, this is Alex calling about our event.", language: tc.language, openingTurn: 1}
		d.customer(tc.text)
		if d.openingNeedsRepair() || d.resumeOpening() {
			t.Fatalf("repair must yield to %q", tc.text)
		}
		if strings.Contains(d.instructions("", nil), "Original opening, as factual reference") || strings.Contains(d.instructions("", nil), "原开场仅作为事实参考") {
			t.Fatalf("refusal or unfinished speech received repair instructions: %q", tc.text)
		}
	}
}

func TestEnglishInterruptedIntroduction(t *testing.T) {
	d := &dialogueRuntime{opening: "Hello, this is Alex calling about an event.", language: "en", openingTurn: 1}
	d.customer("Hello")
	if !d.resumeOpening() || d.openingComplete {
		t.Fatal("English greeting must preserve the interrupted introduction")
	}
	if !strings.Contains(d.instructions("", nil), "Speak English only") {
		t.Fatal("English repair policy is missing")
	}
	d.acceptedBot("This is Alex.", true, 2)
	d.openingPlaybackDone(2, "", true)
	if !d.openingIdentityHeard || d.openingPurposeHeard {
		t.Fatal("English spoken identity progress is incorrect")
	}
	if !strings.Contains(d.instructions("", nil), "only the reason for calling; your identity was already heard") {
		t.Fatal("English repair repeats a spoken identity")
	}
	d.acceptedBot("I'm calling to invite you to our event.", true, 3)
	d.openingPlaybackDone(3, "", true)
	if !d.openingComplete {
		t.Fatal("English introduction never completed")
	}
}

func TestConversationTimingHonorsSpeedAndManualWait(t *testing.T) {
	profile := provider.Profile{SemanticTurnType: "semantic_vad"}
	for _, tc := range []struct {
		speed      string
		wait, want int
	}{
		{"balanced", 0, 750}, {"fast", 0, 500}, {"patient", 0, 1600}, {"fast", 1250, 1250}, {"patient", 500, 500},
	} {
		audio := media.DefaultAudioSettings()
		audio.ResponseSpeed = tc.speed
		audio.ResponseWaitMs = tc.wait
		turn := configuredConversationTurn(audio, profile)
		if turn.SilenceMs != tc.want || turn.Mode != provider.TurnModeSemantic || turn.Threshold < 0.55 {
			t.Fatalf("speed %s / wait %d lost its timing or noise guard: %+v", tc.speed, tc.wait, turn)
		}
	}
}

func TestColloquialWeChatRequestsNeedDirectIntentOrContext(t *testing.T) {
	for _, text := range []string{"哦，行行，加个微信吧", "加个加个微信吧，加加个微信吧，嗯", "你加微信吧，等一会儿再说，行"} {
		if !directWeChatRequest(text) {
			t.Fatalf("explicit colloquial request missed: %s", text)
		}
	}
	for _, text := range []string{"好的，你加我一下，加我一下，我现在正在开车。", "嗯，你先加我吧", "你加就行", "嗯，你先加吧哈"} {
		if directWeChatRequest(text) {
			t.Fatalf("platform was guessed without context: %s", text)
		}
		d := &dialogueRuntime{}
		d.acceptedBot("方便加您微信吗？", true, 1)
		d.customer(text)
		if !d.followUpFocused {
			t.Fatalf("contextual WeChat request missed: %s", text)
		}
	}
	for _, text := range []string{"现在加微信可能不太方便", "关于加微信QQ的事情，我…", "他说加个微信吧", "你加微信吧？", "如果方便就加个微信吧", "别加我微信", "你替他加个微信吧", "机主让你加个微信吧", "怎么加微信"} {
		d := &dialogueRuntime{}
		d.acceptedBot("方便加您微信吗？", true, 1)
		d.customer(text)
		if d.followUpFocused || directWeChatRequest(text) {
			t.Fatalf("unsafe or ambiguous consent: %s", text)
		}
	}
	d := &dialogueRuntime{}
	d.customer("加我微信吧")
	d.customer("现在加微信可能不太方便")
	if d.followUpFocused || d.followUp != "" {
		t.Fatal("later refusal did not revoke earlier follow-up focus")
	}
}

func TestUnclearAnswerCannotAuthorizeWeChatFollowUp(t *testing.T) {
	for _, customer := range []string{"低着头。", "要不要收费", "要不要收费？", "你说什么"} {
		d := &dialogueRuntime{}
		d.acceptedBot("在微信里看。方便的话，我加您微信把直播间发您？", true, 2)
		d.customer(customer)
		d.acceptedBot("好的，那稍后我加您微信把直播间发过去。", true, 3)
		if !d.communicationRepair() {
			t.Fatalf("unconfirmed answer became permission: %s", customer)
		}
	}
}
func TestWeChatConsentGuardPreservesQuestionsAndAgreement(t *testing.T) {
	for _, tc := range []struct{ customer, reply string }{
		{"在哪里看", "方便的话，我加您微信把直播间发您？"},
		{"在哪里看", "如果您愿意，我可以加您微信。"},
		{"你加我微信吧", "好的，我加您微信把直播间发您，再见。"},
		{"可以", "好的，我加您微信把直播间发您，再见。"},
	} {
		d := &dialogueRuntime{}
		d.acceptedBot("方便的话，我加您微信把直播间发您？", true, 2)
		d.customer(tc.customer)
		d.acceptedBot(tc.reply, true, 3)
		if d.communicationRepair() {
			t.Fatalf("valid response intercepted: %s / %s", tc.customer, tc.reply)
		}
	}
}

func TestPricingQuestionsWithoutPunctuationReopenFollowUp(t *testing.T) {
	for _, q := range []string{"要不要收费", "收不收费", "免不免费"} {
		d := &dialogueRuntime{}
		d.customer("加我微信吧")
		d.acceptedBot("好的，我加您微信，再见。", true, 2)
		d.customer(q)
		if d.followUpFocused || !followUpQuestion(q) {
			t.Fatalf("missed question: %s", q)
		}
		d.acceptedBot("不收费，再见。", true, 3)
		if !d.prematureClosing() {
			t.Fatal("question triggered automatic hangup")
		}
	}
}

func TestNaturalAddMeAfterPricingKeepsConsent(t *testing.T) {
	for _, answer := range []string{"好，那你加我。", "那你加我", "好，你加", "你先加我", "加我", "麻烦你加我一下"} {
		d := &dialogueRuntime{}
		d.customer("在哪里看")
		d.acceptedBot("在微信里看。方便的话，我加您微信，把直播间发您。", true, 2)
		d.customer("要不要收费？")
		d.acceptedBot("这场直播是免费的，观看不收费。", true, 3)
		d.customer(answer)
		if d.followUp != "wechat" || !d.followUpFocused {
			t.Fatalf("clear personal request lost recent context: %s", answer)
		}
		d.acceptedBot("好，那我稍后加您微信，把直播间发您，再见。", true, 4)
		if d.communicationRepair() || d.prematureClosing() {
			t.Fatalf("valid closing intercepted: %s", answer)
		}
	}
}
func TestNaturalAddMeCannotGrantConsentWithoutContext(t *testing.T) {
	for _, answer := range []string{"你加我", "加我", "好，你加"} {
		d := &dialogueRuntime{}
		d.customer(answer)
		if d.followUp != "" {
			t.Fatalf("missing context guessed: %s", answer)
		}
	}
	for _, answer := range []string{"我没说你加我", "如果免费你加我", "我朋友说你加我", "你加我干什么", "不要加我", "好，你加我同事", "好的", "低着头"} {
		d := &dialogueRuntime{}
		d.acceptedBot("方便的话，我加您微信。", true, 2)
		d.customer("收费吗")
		d.acceptedBot("观看免费。", true, 3)
		d.customer(answer)
		if d.followUp != "" {
			t.Fatalf("ambiguous or non-personal reply granted consent: %s", answer)
		}
	}
}

// Every call gets its own runtime. Interleave different employees' decisions
// so one caller's consent or rejection cannot change another call's state.
func TestConcurrentCallDialogueIsolation(t *testing.T) {
	for i := 0; i < 60; i++ {
		t.Run(fmt.Sprintf("employee-%d", i), func(t *testing.T) {
			t.Parallel()
			agreed := &dialogueRuntime{}
			declined := &dialogueRuntime{}
			unrelated := &dialogueRuntime{language: "en"}
			agreed.acceptedBot("方便的话，我加您微信。", true, 1)
			declined.acceptedBot("方便的话，我加您微信。", true, 1)
			unrelated.customer("What does it cost?")
			agreed.customer("要不要收费？")
			declined.customer("不要加我")
			agreed.acceptedBot("观看免费。", true, 2)
			agreed.customer("好，那你加我。")
			if agreed.followUp != "wechat" || !agreed.followUpFocused {
				t.Fatal("caller consent was lost")
			}
			if declined.followUp != "" || unrelated.followUp != "" {
				t.Fatal("consent leaked into a different call")
			}
			if unrelated.lastCustomer != "What does it cost?" || unrelated.language != "en" {
				t.Fatal("another call changed this caller's language or transcript")
			}
			agreed.acceptedBot("好，稍后加您微信，再见。", true, 3)
			if agreed.communicationRepair() || agreed.prematureClosing() {
				t.Fatal("accepted follow-up was blocked")
			}
		})
	}
}

// Existing conversational examples simulate an approved reply. New draft
// lifecycle cases use bot/acceptBot/rejectUnheardBot explicitly.
func (d *dialogueRuntime) acceptedBot(text string, final bool, turn int) bool {
	repeated := d.bot(text, final, turn)
	if final {
		d.acceptBot(turn)
	}
	return repeated
}
