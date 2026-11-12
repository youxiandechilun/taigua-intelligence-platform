// 中文导读：既有验证代码：通话中的知识查询与资料上下文处理。
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestKnowledgeUsesSignedCurrentAttempt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/telephony/knowledge/search" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		b, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(b), `"attemptId":"test-attempt"`) {
			t.Error("missing server-owned attempt")
		}
		mac := hmac.New(sha256.New, []byte("fixture-token"))
		mac.Write([]byte(r.Header.Get("X-Sip-Timestamp") + ":"))
		mac.Write(b)
		if r.Header.Get("X-Sip-Signature") != hex.EncodeToString(mac.Sum(nil)) {
			t.Error("signature differs")
		}
		fmt.Fprint(w, `{"success":true,"data":{"items":[{"title":"课程","content":"商务沟通"}]}}`)
	}))
	defer srv.Close()
	a := &app{token: "fixture-token", callback: srv.URL + "/api/v1/telephony/events"}
	if got := a.lookupKnowledge(context.Background(), "test-attempt", "培训课程"); !strings.Contains(got, "商务沟通") {
		t.Fatal(got)
	}
}
func TestKnowledgeRejectsInvalidInputAndRedirects(t *testing.T) {
	var redirected atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	a := &app{token: "fixture-token", callback: source.URL + "/api/v1/telephony/events"}
	for _, query := range []string{"", "a", strings.Repeat("字", 1201), "业务资料"} {
		if got := a.lookupKnowledge(context.Background(), "attempt", query); got != knowledgeUnavailable {
			t.Fatal(got)
		}
	}
	if redirected.Load() != 0 {
		t.Fatal("credentials followed a redirect")
	}
}
func TestKnowledgeBoundsServiceResponse(t *testing.T) {
	for _, body := range []string{`{"success":false}`, `not json`, strings.Repeat("x", 96*1024+1)} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, body) }))
		a := &app{token: "fixture-token", callback: srv.URL + "/api/v1/telephony/events"}
		got := a.lookupKnowledge(context.Background(), "attempt", "业务问题")
		srv.Close()
		if got != knowledgeUnavailable {
			t.Fatal("invalid response accepted")
		}
	}
}
