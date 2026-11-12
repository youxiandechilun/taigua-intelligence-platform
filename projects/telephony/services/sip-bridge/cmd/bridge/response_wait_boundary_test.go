// 中文导读：既有验证代码：response_wait_boundary_test 的输入、输出及边界场景。
package main

import (
	"taigua/sip-bridge/internal/media"
	"taigua/sip-bridge/internal/provider"
	"testing"
)

func TestConversationWait200ReachesSemanticDetection(t *testing.T) {
	a := media.DefaultAudioSettings()
	a.ResponseWaitMs = 200
	p := provider.Profile{SemanticTurnType: "semantic_vad_ec"}
	turn := configuredConversationTurn(a, p)
	if !a.Valid() || turn.SilenceMs != 200 || turn.Mode != provider.TurnModeSemantic {
		t.Fatalf("explicit 200ms was rejected or replaced by a preset: valid=%v turn=%+v", a.Valid(), turn)
	}
	a.ResponseWaitMs = 0
	if got := configuredConversationTurn(a, p).SilenceMs; got != 750 {
		t.Fatalf("unset wait changed preset: %d", got)
	}
}
