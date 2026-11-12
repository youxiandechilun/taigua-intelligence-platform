// 中文导读：模型与语音供应商适配：synthesis_settings.go。供 SIP 语音桥中的相关模块调用。
package provider

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"unicode"
)

// SpeechSynthesisSettings carries the complete expression selected by the
// server. Identity fields assert an existing server-owned binding; they never
// authorize a different model or cloned voice.
type SpeechSynthesisSettings struct {
	VoiceID     string   `json:"voiceId"`
	SourceModel string   `json:"sourceModel"`
	SourceVoice string   `json:"sourceVoice"`
	Model       string   `json:"model"`
	Voice       string   `json:"voice"`
	Rate        *float64 `json:"rate"`
	Pitch       *float64 `json:"pitch"`
	Volume      *int     `json:"volume"`
	Instruction *string  `json:"instruction"`
	Seed        *int     `json:"seed,omitempty"`
}

func (s *SpeechSynthesisSettings) UnmarshalJSON(data []byte) error {
	// Keep the new object strict without changing the legacy call contract.
	type settings SpeechSynthesisSettings
	var decoded settings
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return err
	}
	*s = SpeechSynthesisSettings(decoded)
	return s.Validate()
}

func (s *SpeechSynthesisSettings) Validate() error {
	if s == nil {
		return nil
	}
	for _, value := range []string{s.VoiceID, s.SourceModel, s.SourceVoice, s.Model, s.Voice} {
		if value == "" || value != strings.TrimSpace(value) || len(value) > 512 || strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return errors.New("invalid speech synthesis identity")
		}
	}
	if s.Rate == nil || s.Pitch == nil || s.Volume == nil || s.Instruction == nil {
		return errors.New("incomplete speech synthesis settings")
	}
	if math.IsNaN(*s.Rate) || math.IsInf(*s.Rate, 0) || *s.Rate < .5 || *s.Rate > 2 || math.IsNaN(*s.Pitch) || math.IsInf(*s.Pitch, 0) || *s.Pitch < .5 || *s.Pitch > 2 || *s.Volume < 0 || *s.Volume > 100 {
		return errors.New("invalid speech synthesis expression")
	}
	if len([]rune(*s.Instruction)) > 2000 || strings.IndexFunc(*s.Instruction, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\r'
	}) >= 0 {
		return errors.New("invalid speech synthesis instruction")
	}
	if s.Seed != nil && (*s.Seed < 0 || *s.Seed > 2147483647) {
		return errors.New("invalid speech synthesis seed")
	}
	return nil
}

// EffectiveSpeechSynthesis resolves one call's immutable expression against the
// selected local binding. Omission preserves the legacy binding unchanged.
func EffectiveSpeechSynthesis(scope, model, voice string, settings *SpeechSynthesisSettings) (*SpeechSynthesis, error) {
	if err := settings.Validate(); err != nil {
		return nil, err
	}
	binding, err := ConfiguredSpeechSynthesis(scope, model, voice)
	if err != nil || settings == nil {
		return binding, err
	}
	if binding == nil {
		return nil, errors.New("speech synthesis binding required")
	}
	if settings.VoiceID != binding.VoiceID || settings.SourceModel != model || settings.SourceModel != binding.SourceModel || settings.SourceVoice != voice || settings.SourceVoice != binding.SourceVoice || settings.Model != binding.Model || settings.Voice != binding.Voice {
		return nil, errors.New("speech synthesis identity does not match binding")
	}
	effective := *binding
	effective.Rate = *settings.Rate
	effective.Pitch = *settings.Pitch
	effective.Volume = *settings.Volume
	effective.Instruction = *settings.Instruction
	if settings.Seed != nil {
		seed := *settings.Seed
		effective.Seed = &seed
	}
	return &effective, nil
}
