// 中文导读：开场播放相关的环境音频处理。
package media

import (
	"encoding/binary"
	"math"
	"sort"
)

// OpeningAmbience is a bounded statistical estimate, not a loop of recorded
// audio. It retains no phonemes, conversations, breaths or speaker samples.
type OpeningAmbience struct{ RMS, Correlation float64 }

// AnalyzeOpeningAmbience measures the quietest interior 40ms windows of a
// verified mono 16kHz opening. Reject silent/constant-level input and require
// at least 200ms of low-energy material; estimates cannot prove room identity.
func AnalyzeOpeningAmbience(pcm []byte) *OpeningAmbience {
	const size = 640
	n := len(pcm) / 2
	if len(pcm)%2 != 0 || n < 16000 {
		return nil
	}
	type window struct {
		start int
		rms   float64
	}
	windows := []window{}
	for start := 1600; start+size < n-1600; start += size {
		sum := 0.0
		for i := start; i < start+size; i++ {
			v := float64(int16(binary.LittleEndian.Uint16(pcm[i*2:])))
			sum += v * v
		}
		windows = append(windows, window{start, math.Sqrt(sum / size)})
	}
	if len(windows) < 10 {
		return nil
	}
	sort.Slice(windows, func(i, j int) bool { return windows[i].rms < windows[j].rms })
	count := max(5, len(windows)/10)
	quiet := windows[count-1].rms
	speech := windows[len(windows)*3/4].rms
	if quiet < 8 || speech < 200 || quiet > speech*0.3 {
		return nil
	}
	energy, cross := 0.0, 0.0
	for _, w := range windows[:count] {
		for i := w.start + 1; i < w.start+size; i++ {
			v := float64(int16(binary.LittleEndian.Uint16(pcm[i*2:])))
			prev := float64(int16(binary.LittleEndian.Uint16(pcm[(i-1)*2:])))
			energy += v * v
			cross += v * prev
		}
	}
	return &OpeningAmbience{RMS: math.Min(quiet*0.7, 230), Correlation: math.Max(0, math.Min(0.95, cross/math.Max(1, energy)))}
}

type OpeningAmbienceMixer struct {
	random         uint64
	filtered, gain float64
}

func NewOpeningAmbienceMixer(seed uint64) *OpeningAmbienceMixer {
	if seed == 0 {
		seed = 1
	}
	return &OpeningAmbienceMixer{random: seed}
}
func (s *OpeningAmbienceMixer) Mix(audio []byte, f AudioFormat, profile *OpeningAmbience, percent int) {
	step := 1
	if f.Encoding == EncodingPCM16 {
		step = 2
	}
	if profile == nil || percent <= 0 || f.RateHz <= 0 || len(audio) == 0 || len(audio)%step != 0 {
		return
	}
	target := math.Min(profile.RMS, speechTargetRMS*float64(min(12, percent))/100)
	if target <= 0 || math.IsNaN(target) || math.IsInf(target, 0) {
		return
	}
	energy := 0.0
	for i := 0; i < len(audio); i += step {
		v := sampleAt(audio, i, f.Encoding)
		energy += v * v
	}
	rms := math.Sqrt(energy / float64(len(audio)/step))
	// Fill only the missing floor. Existing recording noise and speech suppress
	// this layer, so opening noise is not blindly doubled.
	wanted := 0.0
	if rms < target {
		wanted = math.Sqrt(1 - rms*rms/(target*target))
	}
	coefficient := math.Pow(math.Max(0, math.Min(0.95, profile.Correlation)), 16000/float64(f.RateHz))
	scale := math.Sqrt(3 * (1 - coefficient*coefficient))
	fade := 1 - math.Exp(-1/(0.04*float64(f.RateHz)))
	for i := 0; i < len(audio); i += step {
		x := s.random
		x ^= x << 13
		x ^= x >> 7
		x ^= x << 17
		s.random = x
		noise := float64(x>>11)/float64(uint64(1)<<53)*2 - 1
		s.filtered = coefficient*s.filtered + scale*noise
		s.gain += fade * (wanted - s.gain)
		v := sampleAt(audio, i, f.Encoding) + target*s.gain*s.filtered
		writeSample(audio, i, f.Encoding, math.Max(-31000, math.Min(31000, v)))
	}
}
