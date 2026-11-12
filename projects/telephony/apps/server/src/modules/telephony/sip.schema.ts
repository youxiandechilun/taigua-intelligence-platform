/*
 * 中文导读：外呼任务输入校验，包括号码、线路、并发、倍数与任务控制参数。
 */
import { assistantDetectionResultSchema } from '../crm/intent-recognition.js';
import {callLimitSchema} from './call-limits.js';
import { z } from 'zod';
import { isIP } from 'node:net';
import { dialPolicySchema, recipientSchema } from '../aliyun/aliyun.schema.js';
import { parallelismSchema } from './task-parallelism.js';
import {taskRetrySchema} from './task-retry.js';

// SIP values reach a switch command; free-form dial strings are never accepted.
export const lineSchema = z.object({
  serviceProvider: z.string().trim().min(1).max(80).default('好客呼'),
  name: z.string().trim().min(1).max(80).default('好客呼国内线路'),
  trunkKey: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).default('haokehu-main'),
  serverIp: z.string().trim().refine(v => !v || isIP(v) === 4, '请填写负责人提供的 IPv4 地址').default(''),
  port: z.number().int().min(1).max(65535).default(5060),
  transport: z.enum(['udp', 'tcp']).default('udp'),
  callerNumber: z.string().trim().regex(/^[0-9A-Za-z_-]{0,30}$/, '主叫标识只能包含字母、数字、下划线或短横线').default(''),
  callerMode: z.enum(['custom', 'provider']).default('custom'),
  prefix: z.string().trim().regex(/^[0-9A-Za-z_-]{0,30}$/, '请填写线路方给出的被叫前缀').default(''),
  employeePrefix: z.string().trim().regex(/^[0-9A-Za-z_-]{0,30}$/, '请填写员工线路前缀').default(''),
  codecs: z.array(z.enum(['PCMA', 'PCMU'])).min(1).max(2).default(['PCMA', 'PCMU']),
  concurrency: callLimitSchema,
  callsPerSecond: callLimitSchema,
  ringTimeoutSeconds: z.number().int().min(5, '响铃等待至少为5秒').max(120, '响铃等待最多为120秒').default(15),
  costPerMinute: z.number().min(0).max(100).nullable().default(null),
  liveEnabled: z.boolean().default(false),
  whitelistConfirmed: z.boolean().default(false),
  carrierPolicy: z.object({
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('21:00'),
    maxCallsPerNumberPerDay: z.number().int().min(0).max(10000).default(0),
    blockedProvinces: z.array(z.string().trim().min(1).max(20)).max(31).default([]),
  }).strict().refine(v => v.start < v.end, '服务商结束时间必须晚于开始时间').nullable().default(null),
  dialPolicy: z.preprocess(value => value && typeof value === 'object' ? {timeRestricted:false,...value} : value, dialPolicySchema).default(() => dialPolicySchema.parse({holidayRestricted:false,timeRestricted:false})),
}).strict();
export type LineSettings = z.infer<typeof lineSchema>;
export const audioSettingsSchema = z.object({
  volume: z.number().int().min(50).max(150).default(100),
  enhanceQuietSpeech: z.boolean().default(true),
  noiseReduction: z.enum(["off","mild"]).default("mild"),
  responseSpeed: z.enum(["fast","balanced","patient"]).default("balanced"),
  responseWaitMs: z.union([z.literal(0),z.number().int().min(200).max(2000)]).default(0),
  sensitivity: z.enum(["normal","sensitive"]).default("sensitive"),
  noInputSeconds: z.number().int().min(1).max(30).default(10),
  backgroundScene: z.enum(['off','office','opening']).default('off'),
  backgroundVolume: z.number().int().min(1).max(12).default(6),
}).strict();
export const sipProfileSchema = z.object({
  audio: audioSettingsSchema.default(()=>audioSettingsSchema.parse({})),
  voiceId: z.string().uuid().or(z.literal('')).default(''),
  realtimeModel: z.enum(['','qwen-audio-3.1-realtime-plus','qwen3.8-omni-flash-realtime','qwen3.5-omni-plus-realtime','qwen3.5-omni-flash-realtime','stepaudio-2.5-realtime','step-1o-audio']).default(''),
  voice: z.string().regex(/^[\p{L}\p{N}_. -]{0,160}$/u).default(''),
  language: z.enum(['zh-CN', 'zh-HK', 'en', 'auto']).default('zh-CN'),
}).strict();
export const dialSelectionSchema=z.object({lineId:z.string().min(1).max(100).optional(),province:z.string().min(1).max(30).optional()});
export const sipTaskSchema = z.object({
  requestId: z.string().uuid().optional(),
  retryPolicy: taskRetrySchema.optional(),
  parallelism: parallelismSchema.default(1),
  ...dialSelectionSchema.shape,
  provider: z.enum(['HAOKEHU_SIP','ALIYUN_ENGINE']).default('HAOKEHU_SIP'),
  name: z.string().trim().min(1).max(100),
  agentId: z.string().uuid(),
  recipients: z.array(recipientSchema).min(1).max(2000),
  startTime: z.iso.datetime({ offset: true }),
  endTime: z.iso.datetime({ offset: true }),
}).strict().refine(t => Date.parse(t.endTime) > Date.parse(t.startTime), '结束时间必须晚于开始时间');
export const eventSchema = z.object({
  eventId: z.string().uuid(),
  attemptId: z.string().uuid(),
  state: z.enum(['DIALING', 'CONNECTED', 'COMPLETED', 'NOT_ANSWERED', 'FAILED']),
  occurredAt: z.iso.datetime(),
  // Real-time intent is carried on the terminal event as a durable fallback
  // when the asynchronous live-transcript callback was delayed or unavailable.
  intent: z.enum(['interested', 'unclear', 'uninterested', 'optout']).optional(),
  intentEvidence: z.string().max(6000).optional(),
  answeringMachineDetected: z.boolean().default(false),
  assistantDetection: assistantDetectionResultSchema.optional(),
  matchedRules: z.array(z.object({
    id: z.string().max(80),
    name: z.string().max(120).optional(),
    intent: z.enum(['interested', 'unclear', 'uninterested', 'optout']),
    keyword: z.string().max(80),
    priority: z.number().int().min(0).max(1000),
  }).strict()).max(100).default([]),
  durationSeconds: z.number().int().min(0).max(3600).default(0),
  reason: z.string().max(200).default(''),
  modelUsage: z.object({
    inputTokens:z.number().int().min(0).max(1e12).nullable().optional(),
    outputTokens:z.number().int().min(0).max(1e12).nullable().optional(),
    totalTokens:z.number().int().min(0).max(1e12).nullable().optional(),
    inputAudioTokens:z.number().int().min(0).max(1e12).nullable().optional(),
    outputAudioTokens:z.number().int().min(0).max(1e12).nullable().optional(),
    cachedTokens:z.number().int().min(0).max(1e12).nullable().optional(),
    requests:z.number().int().min(0).max(10000),
    missingUsage:z.number().int().min(0).max(10000),
    keyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
    connected:z.boolean().optional(),
    observedAt:z.iso.datetime().optional(),
  }).strict().optional(),
  diagnostics: z.object({leg:z.enum(['EMPLOYEE','CUSTOMER']),cause:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),sipStatus:z.number().int().min(100).max(699).optional(),sipDisposition:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional()}).strict().optional(),
  optOutRequested: z.boolean().default(false),
  handoffRequested: z.boolean().default(false),
  recordingFile: z.string().regex(/^[a-f0-9-]{36}\.wav$/).optional(),
  flowTrace: z.array(z.object({nodeId:z.string().max(100),title:z.string().max(100),branch:z.string().max(40),at:z.iso.datetime()}).strict()).max(160).default([]),
  collected: z.record(z.string().max(50),z.string().max(1000)).default({}),
  flowOutcome: z.enum(["neutral","interested","declined","follow_up"]).default("neutral"),
  transcript: z.array(z.object({ speaker: z.enum(['agent', 'customer']), text: z.string().max(6000), timestamp: z.iso.datetime() }).strict()).max(500).default([]),
}).strict();
export type SipEvent = z.infer<typeof eventSchema>;
export const terminalStates = ['COMPLETED', 'NOT_ANSWERED', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW'];
