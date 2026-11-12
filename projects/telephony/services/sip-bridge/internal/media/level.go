// SPDX-License-Identifier: Apache-2.0
// 中文导读：音频电平检测和统计。
package media

import (
	"encoding/binary"
	"math"
	"sort"
)

type AudioSettings struct {
	Volume             int    `json:"volume"`
	EnhanceQuietSpeech bool   `json:"enhanceQuietSpeech"`
	NoiseReduction     string `json:"noiseReduction"`
	ResponseWaitMs     int    `json:"responseWaitMs"`
	ResponseSpeed      string `json:"responseSpeed"`
	Sensitivity        string `json:"sensitivity"`
	NoInputSeconds     int    `json:"noInputSeconds"`
	BackgroundScene    string `json:"backgroundScene"`
	BackgroundVolume   int    `json:"backgroundVolume"`
	// NetworkJitterMs is applied to a new FreeSWITCH customer leg. Zero
	// preserves the existing profile behavior; it does not change this
	// bridge's small RTP reorder buffer.
	NetworkJitterMs int `json:"networkJitterMs"`
}

func DefaultAudioSettings() AudioSettings {
	return AudioSettings{Volume: 100, EnhanceQuietSpeech: true, NoiseReduction: "mild", ResponseSpeed: "balanced", Sensitivity: "sensitive", NoInputSeconds: 10, BackgroundScene: "off", BackgroundVolume: 6}
}
func (a AudioSettings) Valid() bool {
	return ValidNetworkJitterMs(a.NetworkJitterMs) && (a.ResponseWaitMs == 0 || (a.ResponseWaitMs >= 200 && a.ResponseWaitMs <= 2000)) && a.Volume >= 50 && a.Volume <= 150 && (a.NoiseReduction == "off" || a.NoiseReduction == "mild") && (a.ResponseSpeed == "fast" || a.ResponseSpeed == "balanced" || a.ResponseSpeed == "patient") && (a.Sensitivity == "normal" || a.Sensitivity == "sensitive") && a.NoInputSeconds >= 1 && a.NoInputSeconds <= 30 && (a.BackgroundScene == "" || a.BackgroundScene == "off" || a.BackgroundScene == "office" || a.BackgroundScene == "opening") && a.BackgroundVolume >= 0 && a.BackgroundVolume <= 12
}

func ValidNetworkJitterMs(ms int) bool {
	switch ms {
	case 0, 20, 40, 60, 80:
		return true
	default:
		return false
	}
}

// InputLeveler belongs to one call. Estimate the floor before applying gain;
// otherwise quiet-speech enhancement also amplifies room noise. The floor is
// a lower percentile, not the current frame, so a syllable cannot immediately
// teach the filter to remove the caller. This is not speaker separation.
type InputLeveler struct {
	gain, prevX, prevY, noise, attenuation float64
	floorFrames                            [50]float64
	floorCount, floorNext                  int
	clearSpeechMs                          float64
	speechGapMs                            float64
}

func (l *InputLeveler) updateNoise(rms float64) {
	l.floorFrames[l.floorNext] = rms
	l.floorNext = (l.floorNext + 1) % len(l.floorFrames)
	if l.floorCount < len(l.floorFrames) {
		l.floorCount++
	}
	if l.noise == 0 {
		l.noise = math.Max(8, math.Min(rms, 80))
	}
	// Re-evaluate every 100 ms, retaining the preceding second of audio.
	if l.floorCount < 15 || l.floorNext%5 != 0 {
		return
	}
	var window [50]float64
	copy(window[:], l.floorFrames[:l.floorCount])
	sort.Float64s(window[:l.floorCount])
	candidate := math.Max(8, window[l.floorCount/5])
	rate := 0.005 // Do not follow a continuously speaking caller upwards.
	if candidate < l.noise {
		rate = 0.35
	} else if window[l.floorCount*4/5] < candidate*1.5+15 {
		// A steady floor can be followed faster than varying speech.
		rate = 0.12
	}
	l.noise += rate * (candidate - l.noise)
}

func sampleAt(b []byte, i int, e Encoding) float64 {
	switch e {
	case EncodingALaw:
		return float64(alawDecode[b[i]])
	case EncodingMuLaw:
		return float64(muDecode[b[i]])
	default:
		return float64(int16(binary.LittleEndian.Uint16(b[i:])))
	}
}
func writeSample(b []byte, i int, e Encoding, v float64) {
	s := clamp16(v)
	switch e {
	case EncodingALaw:
		b[i] = alawEncode[uint16(s)]
	case EncodingMuLaw:
		b[i] = muEncode[uint16(s)]
	default:
		binary.LittleEndian.PutUint16(b[i:], uint16(s))
	}
}
func (l *InputLeveler) Process(b []byte, f AudioFormat, c AudioSettings) {
	step := 1
	if f.Encoding == EncodingPCM16 {
		step = 2
	}
	if len(b) < step || len(b)%step != 0 {
		return
	}
	var energy, peak float64
	alpha := math.Exp(-2 * math.Pi * 100 / float64(f.RateHz))
	for i := 0; i < len(b); i += step {
		v := sampleAt(b, i, f.Encoding)
		if c.NoiseReduction == "mild" {
			y := alpha * (l.prevY + v - l.prevX)
			l.prevX = v
			l.prevY = y
			v = y
			writeSample(b, i, f.Encoding, v)
		}
		energy += v * v
		peak = math.Max(peak, math.Abs(v))
	}
	rms := math.Sqrt(energy / float64(len(b)/step))
	attenuation := 1.0
	clearSpeech := rms >= 120
	if c.NoiseReduction == "mild" {
		l.updateNoise(rms)
		floor := math.Max(l.noise, 40)
		clearSpeech = clearSpeech && rms >= floor*2.5
		if rms > 0 {
			attenuation = math.Max(0.25, math.Sqrt(math.Max(0, 1-1.1*floor*floor/(rms*rms))))
		} else {
			attenuation = 0.25
		}
		if l.attenuation == 0 {
			l.attenuation = attenuation
		}
		// Release slowly into the floor; let a new syllable through promptly.
		rate := 0.15
		if attenuation > l.attenuation {
			rate = 0.8
		}
		l.attenuation += rate * (attenuation - l.attenuation)
		attenuation = l.attenuation
	}
	frameMs := 1000 * float64(len(b)/step) / float64(f.RateHz)
	if clearSpeech {
		l.clearSpeechMs = math.Min(500, l.clearSpeechMs+frameMs)
		l.speechGapMs = 0
	} else {
		l.speechGapMs += frameMs
		if l.speechGapMs > 120 {
			l.clearSpeechMs = 0
		}
	}
	target := 1.0
	// An isolated click or a weak noise frame must not arm the gain boost.
	if c.EnhanceQuietSpeech && clearSpeech && l.clearSpeechMs >= 60 {
		limit := 2.0
		if l.clearSpeechMs >= 200 {
			limit = 3
		}
		target = math.Max(1, math.Min(limit, 1500/rms))
		// Speech with a clear signal-to-noise ratio should not lose its first
		// short syllable to the noise estimator's release tail.
		attenuation = math.Max(attenuation, 0.85)
	}
	if l.gain < 1 {
		l.gain = 1
	}
	if target < l.gain {
		l.gain = target
	} else {
		l.gain += 0.35 * (target - l.gain)
	}
	gain := l.gain * attenuation
	if peak > 0 {
		gain = math.Min(gain, 28000/peak)
	}
	for i := 0; i < len(b); i += step {
		writeSample(b, i, f.Encoding, sampleAt(b, i, f.Encoding)*gain)
	}
}

// Volume applies before telephone encoding and caps peaks to avoid clipping.
func Volume(b []byte, f AudioFormat, percent int) []byte {
	if percent == 100 || percent == 0 {
		return b
	}
	out := append([]byte(nil), b...)
	step := 1
	if f.Encoding == EncodingPCM16 {
		step = 2
	}
	if len(out)%step != 0 {
		return b
	}
	peak := 0.0
	for i := 0; i < len(out); i += step {
		peak = math.Max(peak, math.Abs(sampleAt(out, i, f.Encoding)))
	}
	gain := float64(percent) / 100
	if peak > 0 {
		gain = math.Min(gain, 30000/peak)
	}
	for i := 0; i < len(out); i += step {
		writeSample(out, i, f.Encoding, sampleAt(out, i, f.Encoding)*gain)
	}
	return out
}
