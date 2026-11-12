// 中文导读：模型与语音供应商适配：startup.go。供 SIP 语音桥中的相关模块调用。
package provider

import (
	"context"
	"errors"
	"io"
	"net"
	"regexp"
	"strings"

	"github.com/gorilla/websocket"
	"taigua/sip-bridge/internal/provider/wsconn"
)

// StartupDiagnostic contains protocol classifications only. Never put the raw
// provider error (which may echo credentials, URLs or caller text) in a log.
type StartupDiagnostic struct {
	Stage      string
	Kind       string
	Code       string
	HTTPStatus int
	Retryable  bool
}

type startupError struct {
	info StartupDiagnostic
	err  error
}

func (e *startupError) Error() string { return "provider startup " + e.info.Stage + ": " + e.info.Kind }
func (e *startupError) Unwrap() error { return e.err }

var safeStartupCode = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,80}$`)

func startupFailure(stage string, err error) error {
	d := StartupDiagnostic{Stage: stage, Kind: "unclassified"}
	var dial *wsconn.DialError
	var wire *wireError
	var network net.Error
	var closed *websocket.CloseError
	switch {
	case errors.As(err, &dial) && dial.HTTPStatus != 0:
		d.HTTPStatus = dial.HTTPStatus
		d.Kind = "http_rejected"
		d.Retryable = dial.HTTPStatus == 502 || dial.HTTPStatus == 503 || dial.HTTPStatus == 504
	case errors.As(err, &wire):
		d.Kind = "session_rejected"
		if safeStartupCode.MatchString(wire.Code) {
			d.Code = wire.Code
		}
		// Auth, credit, quota, rate and parameter failures require a different
		// remedy. Retry only explicit temporary server faults, never keywords
		// in arbitrary provider prose.
		switch strings.ToLower(wire.Code) {
		case "internal_error", "server_error", "service_unavailable", "serviceunavailable", "internalerror":
			d.Retryable = true
		}
	case errors.Is(err, context.Canceled):
		d.Kind = "cancelled"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &network) && network.Timeout():
		d.Kind, d.Retryable = "timeout", true
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		d.Kind, d.Retryable = "connection_ended", true
	case errors.As(err, &closed):
		d.Kind = "connection_closed"
		d.Retryable = closed.Code == websocket.CloseInternalServerErr || closed.Code == websocket.CloseServiceRestart || closed.Code == websocket.CloseTryAgainLater
	}
	return &startupError{info: d, err: err}
}

// StartupFailureInfo can be used for every setup error, but only errors from
// the pre-greeting protocol phase may authorize a fresh session attempt.
func StartupFailureInfo(err error) StartupDiagnostic {
	var startup *startupError
	if errors.As(err, &startup) {
		return startup.info
	}
	return StartupDiagnostic{Stage: "local_setup", Kind: "configuration_or_media"}
}
