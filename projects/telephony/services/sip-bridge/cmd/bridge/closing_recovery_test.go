// 中文导读：既有验证代码：closing_recovery_test 的输入、输出及边界场景。
package main

import "testing"

func TestCompleteRefusalWithFillersEndsButQuestionsRemainOpen(t *testing.T) {
	for _, text := range []string{"呃，不用了，谢谢啊。", "不用啊。", "不需要了，谢谢。", "再见。"} {
		if conversationEnding(text, "zh") == "" {
			t.Errorf("complete refusal not recognized: %s", text)
		}
	}
	for _, text := range []string{"不用啊，谁写的？", "是不是不用收费？", "我同事说不用了", "不用加微信，先说一下价格"} {
		if conversationEnding(text, "zh") != "" {
			t.Errorf("question or reported refusal ended the call: %s", text)
		}
	}
}
