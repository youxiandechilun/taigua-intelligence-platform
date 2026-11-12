// 中文导读：既有验证代码：开场播放相关的环境音频处理。
package media

import (
	"encoding/binary"
	"math"
	"testing"
)

func ambiencePCM(seconds int, quiet bool) []byte {
	b := make([]byte, seconds*16000*2)
	seed := uint64(7)
	for i := 0; i < len(b)/2; i++ {
		seed ^= seed << 13
		seed ^= seed >> 7
		seed ^= seed << 17
		n := float64(seed%1001)/500 - 1
		v := 120 * n
		if !quiet && i%16000 > 4000 {
			v += 5000 * math.Sin(2*math.Pi*170*float64(i)/16000)
		}
		binary.LittleEndian.PutUint16(b[i*2:], uint16(int16(v)))
	}
	return b
}
func TestAmbienceRequiresUsefulQuietMaterial(t *testing.T) {
	for _, b := range [][]byte{nil, make([]byte, 64000), {1}, ambiencePCM(4, true)} {
		if AnalyzeOpeningAmbience(b) != nil {
			t.Fatal("unusable source accepted")
		}
	}
	if AnalyzeOpeningAmbience(ambiencePCM(4, false)) == nil {
		t.Fatal("speech and room floor should produce profile")
	}
}
func TestAmbienceBoundedAndSourceUnchanged(t *testing.T) {
	source := ambiencePCM(4, false)
	copySource := append([]byte(nil), source...)
	p := AnalyzeOpeningAmbience(source)
	if string(source) != string(copySource) {
		t.Fatal("source modified")
	}
	m := NewOpeningAmbienceMixer(9)
	b := make([]byte, 16000)
	m.Mix(b, PCM16Format(8000), p, 6)
	energy := 0.0
	for i := 0; i < len(b); i += 2 {
		v := float64(int16(binary.LittleEndian.Uint16(b[i:])))
		energy += v * v
	}
	rms := math.Sqrt(energy / float64(len(b)/2))
	if rms < 1 || rms > 230 {
		t.Fatalf("floor outside cap: %f", rms)
	}
}
func TestAmbienceDoesNotDoubleExistingFloor(t *testing.T) {
	p := &OpeningAmbience{RMS: 100, Correlation: 0.5}
	b := make([]byte, 3200)
	for i := 0; i < len(b); i += 2 {
		binary.LittleEndian.PutUint16(b[i:], 200)
	}
	before := string(b)
	NewOpeningAmbienceMixer(1).Mix(b, PCM16Format(8000), p, 6)
	if string(b) != before {
		t.Fatal("added noise to existing louder floor")
	}
	NewOpeningAmbienceMixer(1).Mix(b, PCM16Format(8000), nil, 6)
	if string(b) != before {
		t.Fatal("nil profile changed audio")
	}
}
func TestOpeningAmbienceSettingAccepted(t *testing.T) {
	s := DefaultAudioSettings()
	s.BackgroundScene = "opening"
	if !s.Valid() {
		t.Fatal("opening mode rejected")
	}
	s.BackgroundScene = "unknown"
	if s.Valid() {
		t.Fatal("unknown mode accepted")
	}
}
