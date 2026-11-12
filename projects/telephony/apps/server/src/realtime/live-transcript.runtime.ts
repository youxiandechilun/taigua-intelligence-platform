/*
 * 中文导读：共享基础能力：live-transcript.runtime.ts。组织运行期状态与事件处理。
 */
import { redisConnection } from "../config/redis.js";
import { LiveTranscriptStore } from "./live-transcript.store.js";

export const liveTranscriptStore = new LiveTranscriptStore(redisConnection);
