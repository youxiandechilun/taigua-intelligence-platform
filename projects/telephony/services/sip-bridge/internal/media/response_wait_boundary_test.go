// 中文导读：既有验证代码：response_wait_boundary_test 的输入、输出及边界场景。
package media

import "testing"

func TestResponseWaitBoundaryPreservesCompleteAudioSettings(t *testing.T) {
	for _, tc := range []struct {
		wait  int
		valid bool
	}{{0, true}, {199, false}, {200, true}, {300, true}, {2000, true}, {2001, false}} {
		a := DefaultAudioSettings()
		a.ResponseWaitMs = tc.wait
		if a.Valid() != tc.valid {
			t.Fatalf("response wait %d validity = %v; want %v", tc.wait, a.Valid(), tc.valid)
		}
	}
	invalid := DefaultAudioSettings()
	invalid.ResponseWaitMs = 200
	invalid.NoInputSeconds = 0
	if invalid.Valid() {
		t.Fatal("200ms must not disable validation of the remaining audio settings")
	}
}
