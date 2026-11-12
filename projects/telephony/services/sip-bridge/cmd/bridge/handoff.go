// 中文导读：通话转人工的状态与资源处理。
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type handoffTarget struct {
	Available bool   `json:"available"`
	ID        string `json:"reservationId"`
	Phone     string `json:"phone"`
}

func (a *app) handoffAPI(ctx context.Context, input any, out any) error {
	body, e := json.Marshal(input)
	if e != nil {
		return e
	}
	stamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	mac := hmac.New(sha256.New, []byte(a.token))
	mac.Write([]byte(stamp + ":"))
	mac.Write(body)
	req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(a.callback, "/events")+"/handoff", bytes.NewReader(body))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Sip-Timestamp", stamp)
	req.Header.Set("X-Sip-Signature", hex.EncodeToString(mac.Sum(nil)))
	client := http.Client{Timeout: 4 * time.Second}
	res, e := client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("handoff unavailable")
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 8192)).Decode(out)
	}
	return nil
}
func (a *app) reserveHandoff(ctx context.Context, id string) (*handoffTarget, error) {
	var out struct {
		Data handoffTarget `json:"data"`
	}
	e := a.handoffAPI(ctx, map[string]string{"action": "reserve", "attemptId": id}, &out)
	if e != nil {
		return nil, e
	}
	if !out.Data.Available || !phone.MatchString(out.Data.Phone) {
		return nil, errors.New("no available seat")
	}
	if _, e = uuid.Parse(out.Data.ID); e != nil {
		return nil, e
	}
	return &out.Data, nil
}

// Dial only the server-selected, reserved on-duty seat. Keep the customer's AI
// leg alive while it rings. Bridge only after a confirmed answer and verify
// the actual bridge UUID before recording success.
func (a *app) transferHandoff(ctx context.Context, c *call, target *handoffTarget) (err error) {
	seatID := uuid.NewString()
	connected, bridgeApplied := false, false
	defer func() {
		status := "FAILED"
		reason := "SEAT_UNAVAILABLE"
		if connected {
			status = "CONNECTED"
			reason = "SEAT_BRIDGED"
		} else if !bridgeApplied {
			a.link.API("uuid_kill " + seatID + " NORMAL_CLEARING")
		}
		if !bridgeApplied || connected {
			a.persistHandoffResult(map[string]string{"action": "result", "attemptId": c.Req.ID, "reservationId": target.ID, "status": status, "reason": reason})
		}
	}()
	callerVars := ""
	if c.Req.Line.Caller != "" {
		callerVars = ",origination_caller_id_number=" + c.Req.Line.Caller
	}
	endpoint := "sofia/external/" + c.Req.Line.EmployeePrefix + target.Phone + "@" + net.JoinHostPort(c.Req.Line.ServerIP, strconv.Itoa(c.Req.Line.Port)) + ";transport=" + c.Req.Line.Transport
	command := "originate {origination_uuid=" + seatID + callerVars + ",ignore_early_media=true,originate_timeout=20,absolute_codec_string='" + strings.Join(c.Req.Line.Codecs, ",") + "'}" + endpoint + " &park()"
	result, e := a.link.BgAPI(command)
	if e != nil || strings.HasPrefix(strings.TrimSpace(result), "-ERR") {
		return errors.New("seat dial rejected")
	}
	timeout := time.NewTimer(23 * time.Second)
	defer timeout.Stop()
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timeout.C:
			return errors.New("seat timeout")
		case <-tick.C:
			alive, e := a.link.API("uuid_exists " + c.Req.ID)
			if e != nil || strings.TrimSpace(alive) != "true" {
				return errors.New("customer ended")
			}
			answer, e := a.link.API("uuid_getvar " + seatID + " answer_epoch")
			n, _ := strconv.ParseInt(strings.TrimSpace(answer), 10, 64)
			if e != nil || n <= 0 {
				continue
			}
			result, e = a.link.API("uuid_setvar " + c.Req.ID + " hangup_after_bridge false")
			if e != nil || !strings.HasPrefix(strings.TrimSpace(result), "+OK") {
				return errors.New("cannot keep customer leg")
			}
			result, e = a.link.API("uuid_bridge " + c.Req.ID + " " + seatID)
			if e != nil || !strings.HasPrefix(strings.TrimSpace(result), "+OK") {
				a.link.API("uuid_setvar " + c.Req.ID + " hangup_after_bridge true")
				return errors.New("bridge rejected")
			}
			bridgeApplied = true
			for i := 0; i < 15; i++ {
				actual, e := a.link.API("uuid_getvar " + c.Req.ID + " bridge_uuid")
				if e == nil && strings.TrimSpace(actual) == seatID {
					connected = true
					a.link.API("uuid_setvar " + c.Req.ID + " hangup_after_bridge true")
					c.mu.Lock()
					c.EndReason = "HANDOFF_CONNECTED"
					c.mu.Unlock()
					return nil
				}
				select {
				case <-ctx.Done():
					c.mu.Lock()
					c.EndReason = "HANDOFF_UNCONFIRMED"
					c.mu.Unlock()
					return nil
				case <-time.After(100 * time.Millisecond):
				}
			}
			c.mu.Lock()
			c.EndReason = "HANDOFF_UNCONFIRMED"
			c.mu.Unlock()
			slog.Warn("handoff bridge awaiting final receipt", "callId", c.Req.ID)
			// The bridge command succeeded but its confirmation is unknown. Detach the
			// old AI leg; preserve the seat reservation until the parent call finishes.
			return nil
		}
	}
}

// A successful transfer is durable even when the API restarts during callback.
// The queue contains identifiers and status only, never a seat phone number.
func (a *app) persistHandoffResult(result map[string]string) {
	b, e := json.Marshal(result)
	if e != nil {
		return
	}
	path := filepath.Join(a.stateDir, "handoffs", result["reservationId"]+".json")
	if e = os.WriteFile(path+".tmp", b, 0600); e == nil {
		os.Rename(path+".tmp", path)
	}
}
func (a *app) flushHandoffs(ctx context.Context) {
	files, _ := filepath.Glob(filepath.Join(a.stateDir, "handoffs", "*.json"))
	for _, file := range files {
		b, e := os.ReadFile(file)
		if e != nil {
			continue
		}
		var result map[string]string
		if json.Unmarshal(b, &result) != nil {
			continue
		}
		if a.handoffAPI(ctx, result, nil) == nil {
			os.Remove(file)
		}
	}
}
