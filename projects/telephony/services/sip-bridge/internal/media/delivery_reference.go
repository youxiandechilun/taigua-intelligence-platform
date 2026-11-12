// 中文导读：播放参考音频与输出参数辅助。
package media

import (
	"encoding/binary"
	"math"
	"sort"
)

// DeliveryReference describes the selected recording; it is not an emotion
// detector, a speaker identity check, or a promise of exact style transfer.
type DeliveryReference struct {
	ActiveSeconds float64
	PauseMedianMS int
	PauseCount    int
	PitchMedianHz float64
	PitchP10Hz    float64
	PitchP90Hz    float64
}

func quantile(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	x := p * float64(len(values)-1)
	i := int(x)
	if i+1 == len(values) {
		return values[i]
	}
	return values[i] + (values[i+1]-values[i])*(x-float64(i))
}

// AnalyzeDelivery uses only a verified 16 kHz mono PCM recording. Relative
// energy separates phrase gaps from a steady recorded background. Pitch is a
// conservative autocorrelation estimate on decimated 40 ms frames; it is never
// used to change the selected speaker or pitch-shift their recording.
func AnalyzeDelivery(pcm []byte) DeliveryReference {
	var result DeliveryReference
	if len(pcm) < 1280 || len(pcm)%2 != 0 {
		return result
	}
	levels := make([]float64, 0, len(pcm)/640)
	for start := 0; start+640 <= len(pcm); start += 640 {
		var energy float64
		for i := start; i < start+640; i += 2 {
			v := float64(int16(binary.LittleEndian.Uint16(pcm[i:])))
			energy += v * v
		}
		levels = append(levels, 20*math.Log10(math.Max(1, math.Sqrt(energy/320))/32768))
	}
	ordered := append([]float64(nil), levels...)
	sort.Float64s(ordered)
	low, high := quantile(ordered, .1), quantile(ordered, .9)
	threshold := math.Max(-45, math.Min(-22, low+.35*(high-low)))
	pauses := []float64{}
	gap := 0
	started := false
	for _, db := range levels {
		if db >= threshold {
			result.ActiveSeconds += .02
			if started && gap >= 10 && gap <= 75 {
				pauses = append(pauses, float64(gap*20))
			}
			gap = 0
			started = true
		} else if started {
			gap++
		}
	}
	if len(pauses) > 0 {
		sort.Float64s(pauses)
		result.PauseCount = len(pauses)
		result.PauseMedianMS = int(quantile(pauses, .5))
	}
	pitches := []float64{}
	for start := 0; start+1280 <= len(pcm); start += 1280 {
		var frame [160]float64
		var mean, energy float64
		for i := range frame {
			// Average each group before decimation to reduce high-frequency
			// aliasing; pitch here is only a coarse delivery reference.
			for j := 0; j < 4; j++ {
				frame[i] += float64(int16(binary.LittleEndian.Uint16(pcm[start+(i*4+j)*2:]))) / 4
			}
			mean += frame[i]
		}
		mean /= float64(len(frame))
		for i := range frame {
			frame[i] -= mean
			energy += frame[i] * frame[i]
		}
		if 20*math.Log10(math.Max(1, math.Sqrt(energy/160))/32768) < threshold {
			continue
		}
		var correlations [59]float64
		for lag := 11; lag <= 57; lag++ {
			var product, left, right float64
			for i := 0; i < 80; i++ {
				a, b := frame[i], frame[i+lag]
				product += a * b
				left += a * a
				right += b * b
			}
			if left*right > 0 {
				correlations[lag] = product / math.Sqrt(left*right)
			}
		}
		best := 0
		for lag := 12; lag <= 56; lag++ {
			if correlations[lag] >= .82 && correlations[lag] >= correlations[lag-1] && correlations[lag] > correlations[lag+1] {
				if best == 0 || correlations[lag] > correlations[best]+.08 {
					best = lag
				}
			}
		}
		if best > 0 {
			pitches = append(pitches, 4000/float64(best))
		}
	}
	if len(pitches) >= 8 {
		sort.Float64s(pitches)
		result.PitchMedianHz = quantile(pitches, .5)
		result.PitchP10Hz = quantile(pitches, .1)
		result.PitchP90Hz = quantile(pitches, .9)
	}
	return result
}
