// 中文导读：通话背景场景音频处理。
package media

import "math"

// OfficeScene produces a quiet room bed and occasional short keyboard effects.
// It contains no speech or sampled personal audio, and belongs to one call's
// send loop. Silence, the recorded opening and AI speech share its timeline.
type OfficeScene struct {
	random                                     uint64
	room, previous, envelope, clickPhase, duck float64
	wait, remaining, cluster                   int
	speaking                                   bool
}

func NewOfficeScene(seed uint64) *OfficeScene {
	if seed == 0 {
		seed = 1
	}
	return &OfficeScene{random: seed, wait: -1, duck: 1}
}

func (s *OfficeScene) noise() float64 {
	x := s.random
	x ^= x << 13
	x ^= x >> 7
	x ^= x << 17
	s.random = x
	return float64(x>>11)/float64(uint64(1)<<53)*2 - 1
}

// Mix changes only the owned outgoing frame. Keyboard effects are suppressed
// while speech is queued, and background level stays far below normal speech.
func (s *OfficeScene) Mix(audio []byte, f AudioFormat, percent int, speech bool) {
	step := 1
	if f.Encoding == EncodingPCM16 {
		step = 2
	}
	if f.RateHz <= 0 || len(audio)%step != 0 || percent <= 0 {
		return
	}
	percent = min(12, percent)
	if s.wait < 0 {
		s.wait = f.RateHz * 3
	}
	if speech && !s.speaking {
		s.remaining, s.envelope, s.cluster = 0, 0, 0
	}
	if speech {
		s.wait = max(s.wait, f.RateHz)
	}
	s.speaking = speech
	level := speechTargetRMS * float64(percent) / 100
	alpha := 1 - math.Exp(-2*math.Pi*350/float64(f.RateHz))
	decay := math.Exp(-1 / (0.012 * float64(f.RateHz)))
	duckRate := 1 - math.Exp(-1/(0.04*float64(f.RateHz)))
	for i := 0; i < len(audio); i += step {
		n := s.noise()
		s.room += alpha * (n - s.room)
		room := s.room * 1.8
		target := 1.0
		if speech {
			target = 0.5
		}
		s.duck += duckRate * (target - s.duck)
		room *= s.duck
		if s.wait > 0 {
			s.wait--
		}
		if !speech && s.wait == 0 && s.remaining == 0 {
			if s.cluster == 0 {
				s.cluster = 2 + int(math.Abs(s.noise())*3)
			}
			s.remaining = f.RateHz / 18
			s.envelope = 1
			s.clickPhase = 0
			s.cluster--
			if s.cluster > 0 {
				s.wait = f.RateHz * (90 + int(math.Abs(s.noise())*130)) / 1000
			} else {
				s.wait = f.RateHz * (5 + int(math.Abs(s.noise())*11))
			}
		}
		click := 0.0
		if s.remaining > 0 {
			s.clickPhase += 2 * math.Pi * 1250 / float64(f.RateHz)
			click = s.envelope * (0.5*(n-s.previous) + 0.25*math.Sin(s.clickPhase))
			s.envelope *= decay
			s.remaining--
		}
		s.previous = n
		v := sampleAt(audio, i, f.Encoding) + level*(room+click)
		writeSample(audio, i, f.Encoding, math.Max(-31000, math.Min(31000, v)))
	}
}
