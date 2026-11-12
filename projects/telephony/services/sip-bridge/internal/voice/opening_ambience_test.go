// 中文导读：既有验证代码：开场播放相关的环境音频处理。
package voice

import "testing"

func TestOpeningAmbienceRouting(t *testing.T) {
	r := &RTPSession{}
	r.SetBackgroundScene("opening", 6)
	if r.background.Load() != 22 {
		t.Fatal("opening mode lost")
	}
	r.SetOpeningAmbience(nil)
	if r.openingAmbience.Load() != nil {
		t.Fatal("invalid source produces ambience")
	}
	r.SetBackgroundScene("opening", 0)
	if r.background.Load() != 0 {
		t.Fatal("zero must silence opening ambience")
	}
	r.SetBackgroundScene("office", 6)
	if r.background.Load() != 6 {
		t.Fatal("office mode changed")
	}
	r.SetBackgroundScene("off", 6)
	if r.background.Load() != 0 {
		t.Fatal("off still audible")
	}
}
