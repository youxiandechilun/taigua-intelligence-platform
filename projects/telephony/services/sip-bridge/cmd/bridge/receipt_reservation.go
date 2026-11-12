// 中文导读：请求回执与资源占用的辅助管理。
package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"taigua/sip-bridge/internal/esl"
)

// The existing receipt reconciler is the sole publisher of BACKGROUND_JOB
// failures. The bridge only releases the corresponding unused memory slot.
type publishedOriginateFailure struct {
	AttemptID   string    `json:"attemptId"`
	JobID       string    `json:"jobId"`
	Cause       string    `json:"cause"`
	ObservedAt  time.Time `json:"observedAt"`
	PublishedAt time.Time `json:"publishedAt"`
	Published   bool      `json:"published"`
	Skipped     string    `json:"skipped"`
}

var reservationFailureCause = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,79}$`)

func (a *app) releaseReservation(c *call) {
	c.reservationOnce.Do(func() {
		if a.calls.CompareAndDelete(c.Req.ID, c) {
			a.pending.Add(-1)
		}
	})
}

func (a *app) failedReservationReceipt(c *call, jobID string) bool {
	parsed, err := uuid.Parse(jobID)
	if err != nil || parsed.String() != jobID {
		return false
	}
	path := filepath.Join(a.stateDir, "originate-receipts", jobID+".json")
	st, err := os.Stat(path)
	if err != nil || !st.Mode().IsRegular() || st.Size() > 64*1024 {
		return false
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	var receipt publishedOriginateFailure
	if json.Unmarshal(body, &receipt) != nil || receipt.AttemptID != c.Req.ID || receipt.JobID != jobID || !receipt.Published || receipt.Skipped != "" || !reservationFailureCause.MatchString(receipt.Cause) {
		return false
	}
	now := time.Now()
	return !receipt.ObservedAt.IsZero() && receipt.ObservedAt.After(c.Started.Add(-time.Second)) && now.Sub(receipt.ObservedAt) >= 15*time.Second && !receipt.PublishedAt.IsZero() && !receipt.PublishedAt.Before(receipt.ObservedAt) && receipt.PublishedAt.Before(now.Add(time.Minute))
}

func (a *app) reconcileFailedReservation(c *call, statusLink *esl.Link) {
	c.mu.Lock()
	jobID := c.OriginateJobID
	eligible := c.Req.Mode != "MANUAL" && c.CustomerID == "" && !c.Finished && c.Dialog == nil && c.Model == nil && !c.Handoff
	c.mu.Unlock()
	if !eligible || !a.failedReservationReceipt(c, jobID) || !a.link.IsUp() || !statusLink.IsUp() {
		return
	}
	active, err := statusLink.API("uuid_exists " + c.Req.ID)
	if err != nil || strings.TrimSpace(active) != "false" {
		return
	}
	if st, err := os.Stat(filepath.Join(a.recordDir, c.Req.ID+".wav")); err == nil {
		if !st.Mode().IsRegular() || st.Size() > 44 {
			return
		}
	} else if !os.IsNotExist(err) {
		return
	}
	// Recheck while locked: an actual dialog or a real terminal event wins any
	// race with the file/channel checks. Never stop media or emit a second result.
	c.mu.Lock()
	if c.Finished || c.Dialog != nil || c.Model != nil || c.Handoff || c.OriginateJobID != jobID {
		c.mu.Unlock()
		return
	}
	c.Finished = true
	a.releaseReservation(c)
	c.mu.Unlock()
	slog.Info("released failed originate reservation", "attemptId", c.Req.ID, "jobId", jobID)
}

func (a *app) reconcileFailedReservations(ctx context.Context) {
	// A delayed status reply must not occupy the serialized originate/control
	// command connection. This connection never sends a mutating command.
	statusLink := esl.NewLink(env("SIP_ESL_ADDR", "127.0.0.1:18021"), os.Getenv("SIP_ESL_PASSWORD"), nil)
	go statusLink.Run(ctx)
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if !a.link.IsUp() || !statusLink.IsUp() {
				continue
			}
			processed := 0
			deadline := time.Now().Add(500 * time.Millisecond)
			a.calls.Range(func(_, value any) bool {
				if ctx.Err() != nil || processed >= 80 || time.Now().After(deadline) {
					return false
				}
				c := value.(*call)
				c.mu.Lock()
				jobID := c.OriginateJobID
				eligible := !c.Finished && c.Dialog == nil && time.Since(c.Started) >= 15*time.Second
				c.mu.Unlock()
				if eligible && a.failedReservationReceipt(c, jobID) {
					processed++
					a.reconcileFailedReservation(c, statusLink)
				}
				return true
			})
		}
	}
}
