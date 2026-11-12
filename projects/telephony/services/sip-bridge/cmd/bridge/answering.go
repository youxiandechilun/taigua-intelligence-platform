// 中文导读：接听与通话开始阶段的辅助处理。
package main

import (
	"strings"
	"time"
	"unicode"
)

// Only explicit announcements at the start of a received turn are terminal.
// A keyword, silence, a greeting, or a person discussing assistants is not.
func answeringNormalized(text string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			return -1
		}
		return unicode.ToLower(r)
	}, text)
}

func answeringMachineAnnouncement(text string) bool {
	t := answeringNormalized(text)
	for i := 0; i < 5; i++ {
		before := t
		for _, greeting := range []string{"您好", "你好", "喂", "哎", "嗯", "hello", "hi"} {
			t = strings.TrimPrefix(t, greeting)
		}
		if t == before {
			break
		}
	}
	// ASR may omit the first syllable or substitute 留言 with 流言.
	// Match the remaining explicit announcement, never the word 助手 alone.
	for _, prefix := range []string{"转至语音留言", "转到语音留言", "转入语音留言", "转至语音信箱", "转入语音信箱", "我是机器人助手", "我是智能电话助手", "我是机主的电话助理", "我是机主的语音助手", "我是小爱同学", "我是小艾同学", "我是小爱电话助理", "我是小艺通话助手"} {
		if strings.HasPrefix(t, prefix) {
			return true
		}
	}
	for _, prefix := range []string{"话已转至语音留言", "话已转到语音留言", "话已转入语音留言", "话已转至语音信箱", "电话已转至语音留言", "电话已转入语音信箱", "已转至语音留言", "已转到语音留言", "已转入语音留言", "已转至语音信箱", "已转入语音信箱", "通话已转入语音留言", "你尝试联系的用户无法接听", "您尝试联系的用户无法接听", "通话已转至语音留言", "通话已转到语音留言", "您的通话已转至语音留言", "您拨打的电话已转入语音信箱", "您拨打的电话已转至语音信箱", "欢迎使用语音信箱", "这里是语音信箱", "请在提示音后留言", "请在提示音后录制留言", "请在嘟声后留言", "请在滴声后留言", "我是智能接听助理", "我是智能接听助手", "我是电话代接助手", "我是语音代接助手", "我是语音信箱", "thepersonyouaretryingtoreachisunavailable", "yourcallhasbeenforwardedtovoicemail", "pleaseleaveamessageafterthetone"} {
		if strings.HasPrefix(t, prefix) {
			return true
		}
	}
	// Two-second ASR blocks can lose a leading syllable or repeat an overlap.
	// A voicemail prompt plus an explicit unavailable/leave-message instruction
	// is strong evidence even when the initial "通" was clipped. Discussion or
	// reported speech is excluded before matching this bounded announcement.
	head := string([]rune(t)[:min(len([]rune(t)), 120)])
	reported := false
	for _, phrase := range []string{"刚才", "他说", "她说", "你说", "听见", "听到", "你是", "您是", "不是", "不想用"} {
		reported = reported || strings.Contains(head, phrase)
	}
	if !reported && (strings.HasPrefix(t, "话已") || strings.HasPrefix(t, "电话已") || strings.HasPrefix(t, "通话已") || strings.HasPrefix(t, "已转") || strings.HasPrefix(t, "转至") || strings.HasPrefix(t, "转入") || strings.HasPrefix(t, "您的电话") || strings.HasPrefix(t, "您拨打") || strings.HasPrefix(t, "你拨打")) {
		voicemail := strings.Contains(head, "语音留言") || strings.Contains(head, "语音信箱") || strings.Contains(head, "语音流言")
		duty := strings.Contains(head, "无法接听") || strings.Contains(head, "提示音后") || strings.Contains(head, "录音完成后")
		if voicemail && duty {
			return true
		}
	}
	// Some mobile assistants first play a carrier-style unavailable announcement,
	// then identify themselves. Inspect only the clause immediately following a
	// known announcement, with both an explicit identity and an answering duty.
	// Do not search arbitrary human speech for an embedded assistant keyword.
	if !reported {
		for _, prefix := range []string{"您拨打的电话正在通话中", "你拨打的电话正在通话中", "您拨打的用户正在通话中", "你拨打的用户正在通话中", "您拨打的电话暂时无法接听", "你拨打的电话暂时无法接听", "您拨打的用户暂时无法接听", "你拨打的用户暂时无法接听", "您拨打的电话无人接听", "你拨打的电话无人接听", "您拨打的用户无人接听", "你拨打的用户无人接听"} {
			if strings.HasPrefix(head, prefix) && answeringProxyIntroduction(strings.TrimPrefix(head, prefix)) {
				return true
			}
		}
	}
	// Named mobile assistants must also state that they are answering for someone.
	if !reported && (strings.HasPrefix(t, "我是") || strings.HasPrefix(t, "这里是") || strings.HasPrefix(t, "我这边是") || strings.HasPrefix(t, "您正在与")) {
		intro := []rune(t)
		if len(intro) > 70 {
			intro = intro[:70]
		}
		head := string(intro)
		return answeringProxyIntroduction(head)
	}
	return false
}

func answeringProxyIntroduction(text string) bool {
	for _, greeting := range []string{"您好", "你好"} {
		text = strings.TrimPrefix(text, greeting)
	}
	for _, intro := range []string{"我是", "这里是", "我这边是", "您正在与"} {
		if !strings.HasPrefix(text, intro) {
			continue
		}
		identity := strings.TrimPrefix(text, intro)
		for _, name := range []string{"机主的智能助理", "机主的智能助手", "机主的电话助理", "机主的语音助手", "主人的智能助理", "主人的智能助手", "小爱同学", "小艾同学", "小爱电话助理", "小艺通话助手", "机器人助手", "智能电话助手", "智能接听助理", "智能接听助手", "电话代接助手", "语音代接助手", "小爱", "小艾", "小艺", "小布", "小v", "语音助手", "智能助理", "智能助手", "电话助理", "接听助理", "接听助手", "通话助手"} {
			if !strings.HasPrefix(identity, name) {
				continue
			}
			// A person selling or developing assistant products is not the proxy.
			suffix := strings.TrimPrefix(identity, name)
			product := false
			for _, description := range []string{"产品", "的产品", "研发", "开发", "销售", "行业", "公司"} {
				product = product || strings.HasPrefix(suffix, description)
			}
			if !product && answeringProxyDuty(text) {
				return true
			}
		}
	}
	return false
}

func answeringProxyDuty(text string) bool {
	for _, duty := range []string{"代接", "代为接听", "帮他接听", "帮她接听", "帮主人接听", "帮机主接听", "替他接听", "替她接听", "替主人接听", "替机主接听", "为主人接听", "为机主接听", "机主暂时", "机主现在", "主人暂时", "主人现在", "帮您记录", "帮你记录", "帮您转达", "帮你转达", "为您转达", "为你转达", "代为转达", "请问您找", "请问你找", "有什么事", "有什么事情"} {
		if strings.Contains(text, duty) {
			return true
		}
	}
	return false
}

// A model tool must cite actual inbound text; model output cannot serve as
// evidence that the recipient is an assistant.
func groundedAnsweringEvidence(evidence, received string) bool {
	e := answeringNormalized(evidence)
	return e != "" && strings.Contains(answeringNormalized(received), e) && answeringMachineAnnouncement(evidence)
}

type answeringTranscript struct {
	partial         string
	pendingIdentity string
	pendingAt       time.Time
}

// Only a complete, explicit self-identification may span two final ASR turns.
// General references to an assistant or a third party are never accumulated.
func pendingAnsweringIdentity(text string) bool {
	t := answeringNormalized(text)
	for _, greeting := range []string{"您好", "你好", "喂", "hello", "hi"} {
		t = strings.TrimPrefix(t, greeting)
	}
	for _, intro := range []string{"我是", "这里是", "我这边是", "您正在与"} {
		if !strings.HasPrefix(t, intro) {
			continue
		}
		identity := strings.TrimPrefix(t, intro)
		for _, name := range []string{"机主的智能助理", "机主的智能助手", "机主的语音助手", "机主的电话助理", "主人的智能助理", "主人的智能助手", "小布", "小v", "小艺", "小爱", "小艾", "语音助手", "智能助理", "智能助手", "电话助理", "接听助理", "接听助手", "通话助手"} {
			if identity == name {
				return true
			}
		}
	}
	return false
}

func (s *answeringTranscript) add(text string, final bool) string {
	if time.Since(s.pendingAt) > 5*time.Second {
		s.pendingIdentity = ""
	}
	if final {
		s.partial = ""
		combined := s.pendingIdentity + text
		s.pendingIdentity = ""
		if pendingAnsweringIdentity(text) {
			s.pendingIdentity, s.pendingAt = text, time.Now()
		}
		return combined
	}
	s.partial += text
	if len([]rune(s.partial)) > 300 {
		s.partial = ""
	}
	return s.pendingIdentity + s.partial
}
