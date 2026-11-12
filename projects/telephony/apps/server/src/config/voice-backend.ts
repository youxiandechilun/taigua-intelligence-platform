/*
 * 中文导读：后端 voice-backend 配置与依赖初始化。
 */
import "dotenv/config";
export const voiceBackend = process.env.VOICE_BACKEND?.trim().toLowerCase() === "legacy"
  ? "legacy" : "aliyun";

export const isAliyunVoice = voiceBackend === "aliyun";
