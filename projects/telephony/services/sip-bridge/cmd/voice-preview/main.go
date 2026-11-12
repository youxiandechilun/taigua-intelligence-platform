// Offline rendering with the same output level, volume, telephone codec and
// ambience functions as calls. The process has no credentials or network use.
// 中文导读：共享基础能力：main.go。供 SIP 语音桥中的相关模块调用。
package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"taigua/sip-bridge/internal/media"
)

type request struct {
	Audio            []byte `json:"audio"`
	Opening          []byte `json:"opening"`
	Volume           int    `json:"volume"`
	Scene            string `json:"scene"`
	BackgroundVolume int    `json:"backgroundVolume"`
}

func pcm(b []byte) ([]byte, int, error) {
	if len(b) < 44 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return nil, 0, errors.New("wav")
	}
	rate := 0
	for i := 12; i+8 <= len(b); {
		n := int(binary.LittleEndian.Uint32(b[i+4:]))
		k := i + 8
		if n < 0 || k+n > len(b) {
			break
		}
		switch string(b[i : i+4]) {
		case "fmt ":
			if n < 16 || binary.LittleEndian.Uint16(b[k:]) != 1 || binary.LittleEndian.Uint16(b[k+2:]) != 1 || binary.LittleEndian.Uint16(b[k+14:]) != 16 {
				return nil, 0, errors.New("pcm")
			}
			rate = int(binary.LittleEndian.Uint32(b[k+4:]))
		case "data":
			if rate < 8000 || rate > 48000 || n%2 != 0 {
				return nil, 0, errors.New("rate")
			}
			return b[k : k+n], rate, nil
		}
		i = k + n + n%2
	}
	return nil, 0, errors.New("data")
}
func render(r request) ([]byte, error) {
	p, rate, e := pcm(r.Audio)
	if e != nil {
		return nil, e
	}
	if len(p) > rate*2*120 || r.Volume < 50 || r.Volume > 150 || r.BackgroundVolume < 0 || r.BackgroundVolume > 12 {
		return nil, errors.New("bounds")
	}
	var level media.OutputLeveler
	level.BeginTurn()
	p = level.Process(p, media.PCM16Format(rate))
	p = media.Volume(p, media.PCM16Format(rate), r.Volume)
	c, e := media.NewConverter(media.PCM16Format(rate), media.G711Format(media.LawAlaw))
	if e != nil {
		return nil, e
	}
	speech := append([]byte(nil), c.Convert(nil, p)...)
	end := len(speech)
	speech = append(speech, media.LawAlaw.Encode(nil, make([]int16, 8000*4))...)
	office := media.NewOfficeScene(271828)
	amb := media.NewOpeningAmbienceMixer(271828)
	var profile *media.OpeningAmbience
	if r.Scene == "opening" {
		opening, hz, err := pcm(r.Opening)
		if err != nil || hz != 16000 {
			return nil, errors.New("opening")
		}
		profile = media.AnalyzeOpeningAmbience(opening)
	} else if r.Scene != "off" && r.Scene != "office" {
		return nil, errors.New("scene")
	}
	for i := 0; i < len(speech); i += 160 {
		b := speech[i:min(i+160, len(speech))]
		if r.Scene == "office" {
			office.Mix(b, media.G711Format(media.LawAlaw), r.BackgroundVolume, i < end)
		}
		if r.Scene == "opening" {
			amb.Mix(b, media.G711Format(media.LawAlaw), profile, r.BackgroundVolume)
		}
	}
	p = media.PCM16ToBytes(nil, media.LawAlaw.Decode(nil, speech))
	h := make([]byte, 44)
	copy(h, "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(len(p)+36))
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1)
	binary.LittleEndian.PutUint16(h[22:], 1)
	binary.LittleEndian.PutUint32(h[24:], 8000)
	binary.LittleEndian.PutUint32(h[28:], 16000)
	binary.LittleEndian.PutUint16(h[32:], 2)
	binary.LittleEndian.PutUint16(h[34:], 16)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(len(p)))
	return append(h, p...), nil
}
func main() {
	var r request
	if json.NewDecoder(io.LimitReader(os.Stdin, 12*1024*1024)).Decode(&r) != nil {
		os.Exit(1)
	}
	out, e := render(r)
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	os.Stdout.Write(out)
}
