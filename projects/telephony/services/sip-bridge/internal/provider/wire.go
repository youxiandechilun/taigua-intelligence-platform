// SPDX-License-Identifier: Apache-2.0
// Taigua adaptation: extracted for the existing workspace-scoped sales system.

// 中文导读：模型与语音供应商适配：wire.go。供 SIP 语音桥中的相关模块调用。
package provider

import (
	"encoding/json"
	"fmt"

	"github.com/gorilla/websocket"

	"taigua/sip-bridge/internal/provider/wsconn"
)

// errSessionClosed is returned by every send once the session has ended. The
// socket owns it; this is the name the client has always known it by.
var errSessionClosed = wsconn.ErrSessionClosed

// wireEvent is the provider protocol's event shape.
//
// It is decoded into a struct rather than a map because audio deltas arrive
// tens of times a second per call, and decoding those into maps was measurable
// allocation churn in the reference implementation.
type wireEvent struct {
	Type    string `json:"type"`
	EventID string `json:"event_id"`
	Session *struct {
		ID            string         `json:"id"`
		TurnDetection map[string]any `json:"turn_detection"`
	} `json:"session"`

	Delta        string `json:"delta"`
	Transcript   string `json:"transcript"`
	ItemID       string `json:"item_id"`
	ResponseID   string `json:"response_id"`
	AudioStartMs *int   `json:"audio_start_ms"`
	AudioEndMs   *int   `json:"audio_end_ms"`

	CallID    string `json:"call_id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`

	Item     *wireItem     `json:"item"`
	Response *wireResponse `json:"response"`
	Error    *wireError    `json:"error"`
}

type wireItem struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	CallID string `json:"call_id"`
}

type wireResponse struct {
	ID     string     `json:"id"`
	Status string     `json:"status"`
	Usage  *wireUsage `json:"usage"`
	Output []wireItem `json:"output"`
}

type wireUsage struct {
	InputTokens    int               `json:"input_tokens"`
	OutputTokens   int               `json:"output_tokens"`
	TotalTokens    int               `json:"total_tokens"`
	InputDetails   *wireTokenDetails `json:"input_tokens_details,omitempty"`
	OutputDetails  *wireTokenDetails `json:"output_tokens_details,omitempty"`
	reported       bool
	inputReported  bool
	outputReported bool
}

type wireTokenDetails struct {
	AudioTokens  *int `json:"audio_tokens,omitempty"`
	CachedTokens *int `json:"cached_tokens,omitempty"`
}

func (u *wireUsage) UnmarshalJSON(data []byte) error {
	type plain wireUsage
	v := struct {
		*plain
		Input            *int              `json:"input_tokens"`
		Output           *int              `json:"output_tokens"`
		Total            *int              `json:"total_tokens"`
		InputDetailsAlt  *wireTokenDetails `json:"input_token_details"`
		OutputDetailsAlt *wireTokenDetails `json:"output_token_details"`
	}{plain: (*plain)(u)}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	if v.Input != nil {
		u.InputTokens = *v.Input
	}
	if v.Output != nil {
		u.OutputTokens = *v.Output
	}
	if u.InputDetails == nil {
		u.InputDetails = v.InputDetailsAlt
	}
	if u.OutputDetails == nil {
		u.OutputDetails = v.OutputDetailsAlt
	}
	u.inputReported, u.outputReported = v.Input != nil, v.Output != nil
	if v.Total != nil {
		u.TotalTokens = *v.Total
	} else {
		u.TotalTokens = u.InputTokens + u.OutputTokens
	}
	u.reported = (v.Total != nil || (v.Input != nil && v.Output != nil)) && u.InputTokens >= 0 && u.OutputTokens >= 0 && u.TotalTokens >= 0
	return nil
}

type wireError struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Param   string `json:"param"`
	EventID string `json:"event_id"`
}

func (e *wireError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("%s: %s", e.Code, e.Message)
	}
	return e.Message
}

// sendEvent encodes one outbound event and writes it.
func (r *Realtime) sendEvent(payload any) error {
	if r.isLocallyClosed.Load() {
		return errSessionClosed
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode outbound event: %w", err)
	}
	return r.conn.SendContext(r.trafficCtx, data)
}

// receive reads and decodes the next event.
func (r *Realtime) receive() (*wireEvent, []byte, error) {
	messageType, data, err := r.conn.Receive()
	if err != nil {
		return nil, nil, err
	}
	if messageType != websocket.TextMessage {
		return nil, data, nil
	}

	var event wireEvent
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, data, fmt.Errorf("decode inbound event: %w", err)
	}
	return &event, data, nil
}
