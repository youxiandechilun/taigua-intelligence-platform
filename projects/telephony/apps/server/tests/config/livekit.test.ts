/*
 * 中文导读：既有验证代码：livekit.test 的输入、输出及边界场景。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_LIVEKIT_AGENT_NAME } from "../../src/config/livekit.js";

test("LiveKit agent dispatch default matches the deployed worker name", () => {
  assert.equal(DEFAULT_LIVEKIT_AGENT_NAME, "quickvoice-voice-agent");
});
