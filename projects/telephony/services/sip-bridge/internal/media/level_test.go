// 中文导读：既有验证代码：音频电平检测和统计。
package media

import (
	"encoding/binary"
	"math"
	"testing"
)

func tone(amplitude float64) []byte {
	b := make([]byte, 320)
	for i := 0; i < 160; i++ {
		binary.LittleEndian.PutUint16(b[i*2:], uint16(int16(amplitude*math.Sin(2*math.Pi*400*float64(i)/8000))))
	}
	return b
}
func energy(b []byte) float64 {
	total := 0.0
	for i := 0; i < len(b); i += 2 {
		v := float64(int16(binary.LittleEndian.Uint16(b[i:])))
		total += v * v
	}
	return math.Sqrt(total / float64(len(b)/2))
}
func TestQuietShortSyllablesSurviveEnhancement(t *testing.T) {
	var l InputLeveler
	cfg := DefaultAudioSettings()
	format := PCM16Format(8000)
	for i := 0; i < 60; i++ {
		b := tone(12)
		l.Process(b, format, cfg)
	}
	raw := energy(tone(500))
	for syllable := 0; syllable < 2; syllable++ {
		var last []byte
		for i := 0; i < 4; i++ {
			last = tone(500)
			l.Process(last, format, cfg)
		}
		if energy(last) < raw*1.2 {
			t.Fatalf("quiet 80ms syllable was not enhanced: %.1f / %.1f", energy(last), raw)
		}
		for i := 0; i < 2; i++ {
			b := tone(12)
			l.Process(b, format, cfg)
		}
	}
}
func TestNoiseAndSingleClickDoNotArmQuietSpeechGain(t *testing.T) {
	var l InputLeveler
	cfg := DefaultAudioSettings()
	format := PCM16Format(8000)
	for i := 0; i < 120; i++ {
		b := tone(20)
		before := energy(b)
		l.Process(b, format, cfg)
		if energy(b) > before*1.05 {
			t.Fatal("noise was boosted")
		}
	}
	click := tone(5000)
	before := energy(click)
	l.Process(click, format, cfg)
	if energy(click) > before*1.05 {
		t.Fatal("isolated 20ms noise was boosted")
	}
}
