// 中文导读：开场内容和播放状态的辅助判断。
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"strings"
	"unicode"
)

// Match Recorded.opening's stable per-attempt selection. The content ledger
// and a generated fallback must describe the same opening as the chosen audio.
func configuredOpening(req request, attempt string) string {
	if req.DemoCall {
		return req.Opening
	}
	choices := []string{}
	for _, clip := range req.Recordings {
		if clip.Key == "opening-recordings" {
			choices = append(choices, clip.Text)
		}
	}
	if len(choices) == 0 {
		return req.Opening
	}
	sum := sha256.Sum256([]byte(attempt))
	selected := choices[int(binary.BigEndian.Uint32(sum[:4]))%len(choices)]
	if strings.TrimSpace(selected) == "" {
		return req.Opening
	}
	return selected
}

// introductionQuestion accepts only a complete contact check. A business
// request in the same utterance must remain a substantive customer turn.
func introductionQuestion(text, language string) bool {
	t := dialogueText(text)
	if strings.HasPrefix(strings.ToLower(language), "en") {
		for {
			before := t
			for _, prefix := range []string{"hello", "hi", "hey", "please"} {
				t = strings.TrimPrefix(t, prefix)
			}
			if before == t {
				break
			}
		}
		switch t {
		case "whoisthis", "whosthis", "whoareyou", "whoscalling", "whoiscalling", "whichcompany", "whichcompanyareyoufrom", "whocompanyareyoufrom", "whereareyoucallingfrom", "whatsthisabout", "whatisthisabout", "whyareyoucalling", "whatdoyouwant":
			return true
		}
		return false
	}
	for {
		before := t
		for _, prefix := range []string{"我想问一下", "麻烦问一下", "请问一下", "请问", "问一下", "你们好", "您们好", "早上好", "下午好", "晚上好", "哈喽", "哈罗", "喂", "您好", "你好", "嗯", "啊", "哦", "噢", "喔", "哎", "诶", "那个"} {
			t = strings.TrimPrefix(t, prefix)
		}
		if before == t {
			break
		}
	}
	t = strings.TrimRight(t, "啊呀呢吗么哈")
	switch t {
	case "哪位", "你哪位", "您哪位", "你是哪位", "您是哪位", "你们是哪位", "谁", "谁呀", "你是谁", "您是谁", "你们是谁",
		"哪里", "哪儿", "哪的", "哪里的", "哪儿的", "你哪里", "您哪里", "你哪的", "您哪的", "你是哪里", "您是哪里", "你们是哪里", "这是哪里", "你这是哪里", "您这是哪里", "你这边是哪里", "你们这边是哪里", "你是哪里的", "您是哪里的", "你们是哪里的", "你是哪儿的", "您是哪儿的", "你是哪边的", "您是哪边的", "你们是哪边的", "哪边的", "哪里打来的", "哪边打来的", "哪家公司打来的",
		"哪家", "哪家公司", "哪个公司", "哪个公司的", "什么公司", "什么单位", "哪个单位", "你是哪家公司", "您是哪家公司", "你们是哪家公司", "你是哪家公司的", "您是哪家公司的", "你们是哪家公司的", "你是哪个公司", "您是哪个公司", "你们是哪个公司", "你是哪个公司的", "您是哪个公司的", "你们是哪个公司的", "你是哪家的", "您是哪家的", "你们是哪家的", "你是哪家", "您是哪家", "你们是哪家", "这是哪家公司", "你是什么公司", "您是什么公司", "这是什么公司", "你是什么单位", "您是什么单位", "你们是什么单位", "你是哪个单位", "您是哪个单位", "你们是哪个单位",
		"什么事", "啥事", "有什么事", "你有什么事", "您有什么事", "什么事情", "有什么事情", "你有什么事情", "您有什么事情", "找我什么事", "找谁", "你找谁", "您找谁", "你找哪位", "您找哪位", "为什么打电话", "为什么给我打电话",
		"你们是干什么的", "你是干什么的", "您是干什么的", "干什么的", "你们是做什么的", "你是做什么的", "您是做什么的", "你们做什么的", "做什么的":
		return true
	}
	return false
}

// openingContent is derived from this call's frozen opening. These fragments
// are a conservative audible-content checklist, never a new script or facts
// shared between agents. Only complete playback may credit a fragment.
func (d *dialogueRuntime) openingContent() []string {
	parts := strings.FieldsFunc(boundedDialogue(d.opening), func(r rune) bool {
		return strings.ContainsRune("，,。.!！?？;；\n", r)
	})
	content := []string{}
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		normal := dialogueText(part)
		if normal == "" || seen[normal] || d.greeting(part) {
			continue
		}
		progress := introductionProgress(part, d.language)
		if progress.identity && !progress.purpose {
			continue
		}
		switch normal {
		case "现在方便吗", "现在方便说话吗", "现在方便接电话吗", "您现在方便吗", "方便吗", "您方便吗", "isthisagoodtime", "isnowagoodtime", "doyouhaveamoment":
			continue
		}
		if len([]rune(normal)) < 4 {
			continue
		}
		seen[normal] = true
		content = append(content, part)
		if len(content) == 8 {
			break
		}
	}
	return content
}

func (d *dialogueRuntime) missingOpeningContent() []string {
	missing := []string{}
	for index, content := range d.openingContent() {
		if !d.openingContentHeard[index] {
			missing = append(missing, content)
		}
	}
	return missing
}

// Match a complete configured line without depending on a provider's turn
// numbering. Punctuation/spacing may differ, but a generic first answer must
// never inherit the content of an opening that was cancelled before starting.
func configuredOpeningCovered(opening, spoken string) bool {
	want, heard := dialogueText(opening), dialogueText(spoken)
	return want != "" && strings.Contains(heard, want)
}

// This is deliberately conservative lexical evidence rather than a claim of
// semantic equivalence. A paraphrase that cannot be verified stays unknown;
// once the caller moves into business, it does not force another opening.
func openingContentCovered(content, spoken, language string) bool {
	want, heard := dialogueText(content), dialogueText(spoken)
	if want == "" || heard == "" {
		return false
	}
	if strings.Contains(heard, want) {
		return true
	}
	// A long near-copy with a changed time or number must not be counted as
	// the configured detail. Unverified paraphrases remain unknown instead.
	for _, number := range strings.FieldsFunc(content, func(r rune) bool { return !unicode.IsNumber(r) }) {
		if !strings.Contains(heard, strings.ToLower(number)) {
			return false
		}
	}
	if strings.HasPrefix(strings.ToLower(language), "en") {
		words := strings.FieldsFunc(strings.ToLower(content), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
		spokenWords := map[string]bool{}
		for _, word := range strings.FieldsFunc(strings.ToLower(spoken), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }) {
			spokenWords[word] = true
		}
		seen, matched, total := map[string]bool{}, 0, 0
		for _, word := range words {
			if seen[word] || strings.Contains("|a|an|the|i|we|you|your|our|to|of|for|in|on|at|is|am|are|this|that|it|and|would|like|", "|"+word+"|") {
				continue
			}
			seen[word] = true
			total++
			if spokenWords[word] {
				matched++
			}
		}
		return total > 0 && matched*100 >= total*75
	}
	runes := []rune(want)
	seen, matched, total := map[string]bool{}, 0, 0
	for index := 0; index+1 < len(runes); index++ {
		pair := string(runes[index : index+2])
		if seen[pair] {
			continue
		}
		seen[pair] = true
		total++
		if strings.Contains(heard, pair) {
			matched++
		}
	}
	return total >= 3 && matched >= 3 && matched*100 >= total*75
}
