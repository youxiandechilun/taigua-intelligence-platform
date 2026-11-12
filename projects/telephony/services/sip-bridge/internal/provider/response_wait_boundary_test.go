// 中文导读：既有验证代码：response_wait_boundary_test 的输入、输出及边界场景。
package provider

import "testing"

func TestSemanticDetectionPayloadCarries200ms(t *testing.T) {
	p := QwenProfile()
	p.Model = "qwen3.8-omni-flash-realtime"
	p.SemanticTurnType = "semantic_vad_ec"
	p.SemanticTurnSilenceMs = 0
	r := &Realtime{profile: p}
	s := r.buildSessionUpdate(SessionConfig{Turn: TurnDetection{Mode: TurnModeSemantic, SilenceMs: 200}}, false)["session"].(map[string]any)
	d := s["turn_detection"].(map[string]any)
	if d["type"] != "semantic_vad_ec" || d["silence_duration_ms"] != 200 {
		t.Fatalf("session payload lost explicit customer pause: %+v", d)
	}
}
