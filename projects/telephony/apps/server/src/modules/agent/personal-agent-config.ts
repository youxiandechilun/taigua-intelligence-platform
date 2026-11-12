/*
 * 中文导读：员工使用数字员工时的个人配置适配。
 */
import { z } from 'zod';
import { sipProfileSchema } from '../telephony/sip.schema.js';
import { communicationProfileSchema } from '../aliyun/aliyun.schema.js';

// Credentials, line access, company membership and knowledge are never copied
// into an employee's editable configuration.
export const personalAgentConfigSchema = z.object({
  agentName: z.string().trim().min(1, '请填写数字员工名称。').max(100),
  enabled: z.boolean(),
  profile: sipProfileSchema,
  communication: communicationProfileSchema,
  textModelId: z.string().max(100),
  maxDurationSeconds: z.number().int().min(60).max(900),
  record: z.boolean(),
}).strict();
export type PersonalAgentConfig = z.infer<typeof personalAgentConfigSchema>;
export function initialPersonalConfig(snapshot: Record<string, unknown>): PersonalAgentConfig {
  return personalAgentConfigSchema.parse({ agentName: snapshot.agentName, enabled: snapshot.enabled !== false,
    profile: snapshot.profile || {}, communication: snapshot.communication || {},
    textModelId: snapshot.textModelId || '', maxDurationSeconds: snapshot.maxDurationSeconds || 300, record: snapshot.record !== false });
}
