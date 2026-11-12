// SPDX-License-Identifier: Apache-2.0
// Taigua adaptation: extracted for the existing workspace-scoped sales system.

// Package wsconn is the WebSocket a provider client talks over.
//
// It carries frames and knows nothing about what is in them: no protocol event,
// no encoding of one, no vendor. That is what lets clients speaking entirely
// different protocols share one socket's hygiene — the single writer, the
// deadlines, the keepalive, the one close — instead of each growing its own
// half of it.
// 中文导读：模型与语音供应商适配：wsconn.go。供 SIP 语音桥中的相关模块调用。
package wsconn

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Connection hygiene the reference implementations lacked. Without it a
// half-open socket looks like a model that has simply stopped talking, and the
// caller sits in silence until they hang up.
const (
	// keepaliveInterval is how often a ping goes out.
	keepaliveInterval = 15 * time.Second
	// readTimeout fails the session when nothing at all arrives. It is reset
	// by any frame, including a pong.
	readTimeout = 45 * time.Second
	// writeTimeout bounds a single send. A socket that cannot absorb a frame
	// of audio within this is not going to recover.
	writeTimeout = 5 * time.Second
	// DialTimeout bounds session setup. This is inside a phone call, so a
	// provider that has not answered by now is not usable. It is exported
	// because a client waits out the rest of its handshake on the same budget.
	DialTimeout = 3 * time.Second
)

// Conn is one WebSocket to a provider.
//
// There is exactly one writer, guarded by a mutex, and one reader. The session
// never reconnects: provider-side conversation state cannot be recovered, so a
// dropped socket ends the session and the call is routed elsewhere instead of
// silently resuming with a model that has forgotten everything.
type Conn struct {
	conn      *websocket.Conn
	header    http.Header
	writeGate chan struct{}
	log       *slog.Logger

	closeOnce sync.Once
	done      chan struct{}
	readOnce  sync.Once
	readDone  chan struct{}
}

// DialError preserves a bounded HTTP status for classification without
// requiring callers to parse or log the endpoint or response body.
type DialError struct {
	HTTPStatus int
	Err        error
}

func (e *DialError) Error() string {
	return fmt.Sprintf("provider websocket dial failed (http %d)", e.HTTPStatus)
}
func (e *DialError) Unwrap() error { return e.Err }

// Dial opens the socket and starts its keepalive.
func Dial(ctx context.Context, endpoint string, headers http.Header, log *slog.Logger) (*Conn, error) {
	ctx, cancel := context.WithTimeout(ctx, DialTimeout)
	defer cancel()

	dialer := websocket.Dialer{HandshakeTimeout: DialTimeout}
	conn, response, err := dialer.DialContext(ctx, endpoint, headers)
	if err != nil {
		status := 0
		if response != nil {
			status = response.StatusCode
			if response.Body != nil {
				_ = response.Body.Close()
			}
		}
		return nil, &DialError{HTTPStatus: status, Err: err}
	}

	c := &Conn{conn: conn, log: log, done: make(chan struct{}),
		writeGate: make(chan struct{}, 1), readDone: make(chan struct{})}
	if response != nil {
		c.header = response.Header
	}
	_ = conn.SetReadDeadline(time.Now().Add(readTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(readTimeout))
	})
	go c.keepalive()
	return c, nil
}

// Header is what the provider answered the upgrade with. Some protocols put
// the session's identity there rather than in a frame.
func (c *Conn) Header() http.Header { return c.header }

// Done closes when the session has ended, however it ended.
func (c *Conn) Done() <-chan struct{} { return c.done }

// Send writes one already-encoded message. It blocks until the frame is on the
// socket, which is the backpressure: a caller that cannot write cannot go on
// producing.
func (c *Conn) Send(data []byte) error {
	return c.SendContext(context.Background(), data)
}

// SendContext bounds both waiting for the single writer and the frame write.
// Shutdown can use its remaining cleanup budget rather than wait behind a
// normal five-second audio write.
func (c *Conn) SendContext(ctx context.Context, data []byte) error {
	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.done:
		return ErrSessionClosed
	case c.writeGate <- struct{}{}:
	}
	defer func() { <-c.writeGate }()

	select {
	case <-c.done:
		return ErrSessionClosed
	default:
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	deadline, _ := ctx.Deadline()
	if err := c.conn.SetWriteDeadline(deadline); err != nil {
		return err
	}
	return c.conn.WriteMessage(websocket.TextMessage, data)
}

// ErrSessionClosed is returned by every send once the session has ended. Its
// wording is the caller's, not this package's: what has ended, as far as anyone
// upstream is concerned, is the provider session.
var ErrSessionClosed = errors.New("provider: session closed")

// Receive reads the next frame and returns it as it arrived. What it means is
// the protocol's business, and this package has no opinion about it.
func (c *Conn) Receive() (messageType int, data []byte, err error) {
	messageType, data, err = c.conn.ReadMessage()
	if err != nil {
		c.readOnce.Do(func() { close(c.readDone) })
		return 0, nil, err
	}
	if err := c.conn.SetReadDeadline(time.Now().Add(readTimeout)); err != nil {
		return 0, nil, err
	}
	return messageType, data, nil
}

func (c *Conn) keepalive() {
	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			err := c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(time.Second))
			if err != nil {
				return
			}
		}
	}
}

// Close ends the session. It is idempotent.
func (c *Conn) Close() {
	c.closeOnce.Do(func() {
		close(c.done)
		// A close frame lets the provider release the session promptly; if it
		// cannot be sent, closing the socket says the same thing less politely.
		_ = c.conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(100*time.Millisecond))
		_ = c.conn.Close()
	})
}

// CloseGracefully gives the existing reader a bounded chance to observe the
// peer's close handshake. It is used only by detached shutdown workers.
func (c *Conn) CloseGracefully(ctx context.Context) {
	c.closeOnce.Do(func() {
		close(c.done)
		defer c.conn.Close()
		deadline := time.Now().Add(100 * time.Millisecond)
		if limit, ok := ctx.Deadline(); ok && limit.Before(deadline) {
			deadline = limit
		}
		if ctx.Err() != nil {
			return
		}
		if err := c.conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), deadline); err != nil {
			return
		}
		select {
		case <-c.readDone:
		case <-ctx.Done():
		}
	})
}
