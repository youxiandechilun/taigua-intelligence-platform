// 中文导读：输出音频电平调整。
package media

import "math"

// Both recordings and generated speech use this level before the user's volume
// setting and telephone encoding. It is an RMS target, not a LUFS measurement.
const speechTargetRMS = 3276.8     // -20 dBFS
const speechActivityFloor = 327.68 // -40 dBFS
const speechPeakCeiling = 29000.0

func speechGain(rms float64) float64 {
	return math.Max(0.25, math.Min(4, speechTargetRMS/rms))
}

// NormalizeRecording applies one gain to the whole verified PCM asset, keeping
// its pauses, emphasis and timing intact. The stored upload is never changed.
func NormalizeRecording(pcm []byte, rate int) []byte {
	if rate <= 0 || len(pcm)%2 != 0 {
		return pcm
	}
	f := PCM16Format(rate)
	frameBytes := max(2, rate/50*2)
	var energy, peak float64
	var active int
	for start := 0; start < len(pcm); start += frameBytes {
		end := min(start+frameBytes, len(pcm))
		var sum float64
		for i := start; i < end; i += 2 {
			v := sampleAt(pcm, i, f.Encoding)
			sum += v * v
			peak = math.Max(peak, math.Abs(v))
		}
		n := (end - start) / 2
		if n > 0 && sum/float64(n) >= speechActivityFloor*speechActivityFloor {
			energy += sum
			active += n
		}
	}
	if active == 0 || peak == 0 {
		return pcm
	}
	gain := math.Min(speechGain(math.Sqrt(energy/float64(active))), speechPeakCeiling/peak)
	out := append([]byte(nil), pcm...)
	for i := 0; i < len(out); i += 2 {
		writeSample(out, i, f.Encoding, sampleAt(out, i, f.Encoding)*gain)
	}
	return out
}

// OutputLeveler estimates one level from the first 300 ms of active audio in a
// model response. Thereafter the gain stays fixed, preserving sentence dynamics
// rather than flattening every syllable. No look-ahead or extra audio is queued.
// One instance belongs to one call and is used only by its output event pump.
type OutputLeveler struct {
	energy        float64
	samples       int
	gain, applied float64
}

func (l *OutputLeveler) BeginTurn() {
	l.energy, l.samples, l.gain, l.applied = 0, 0, 1, 1
}

func (l *OutputLeveler) Process(audio []byte, f AudioFormat) []byte {
	step := 1
	if f.Encoding == EncodingPCM16 {
		step = 2
	}
	if f.RateHz <= 0 || len(audio)%step != 0 {
		return audio
	}
	if l.gain == 0 {
		l.BeginTurn()
	}
	out := append([]byte(nil), audio...)
	frameBytes := max(step, f.RateHz/50*step)
	for start := 0; start < len(out); start += frameBytes {
		end := min(start+frameBytes, len(out))
		n := (end - start) / step
		var sum, peak float64
		for i := start; i < end; i += step {
			v := sampleAt(out, i, f.Encoding)
			sum += v * v
			peak = math.Max(peak, math.Abs(v))
		}
		active := sum/float64(n) >= speechActivityFloor*speechActivityFloor
		if active && l.samples < f.RateHz*3/10 {
			l.energy += sum
			l.samples += n
			l.gain = speechGain(math.Sqrt(l.energy / float64(l.samples)))
		}
		gain := l.gain
		if !active {
			// Never boost the noise floor between phrases.
			gain = math.Min(gain, 1)
		}
		if peak > 0 {
			gain = math.Min(gain, speechPeakCeiling/peak)
		}
		from := l.applied
		if !active {
			from = math.Min(from, 1)
		}
		if peak > 0 {
			// A sudden loud onset must be limited immediately, including while
			// smoothing a transition from the preceding quiet frame.
			from = math.Min(from, speechPeakCeiling/peak)
		}
		for i := start; i < end; i += step {
			ramp := float64((i-start)/step+1) / float64(n)
			writeSample(out, i, f.Encoding, sampleAt(out, i, f.Encoding)*(from+(gain-from)*ramp))
		}
		l.applied = gain
	}
	return out
}
