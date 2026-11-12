// 中文导读：通过带时间戳和 HMAC 的内部请求加载本通电话获准使用的话术音频。
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// 中文注释：签名请求本通可用录音；限制超时、响应大小并禁止自动重定向。
func (a *app) loadScriptRecording(ctx context.Context, attemptID, assetID string) ([]byte, error) {
	body, _ := json.Marshal(map[string]string{"attemptId": attemptID, "assetId": assetID})
	target := strings.TrimSuffix(a.callback, "/events") + "/script-recordings/audio"
	req, err := http.NewRequestWithContext(ctx, "POST", target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	stamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	mac := hmac.New(sha256.New, []byte(a.token))
	mac.Write([]byte(stamp + ":"))
	mac.Write(body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Sip-Timestamp", stamp)
	req.Header.Set("X-Sip-Signature", hex.EncodeToString(mac.Sum(nil)))
	client := &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, errors.New("recording unavailable for this call")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 1440045))
	if err != nil || len(data) > 1440044 {
		return nil, errors.New("recording response invalid")
	}
	return data, nil
}
