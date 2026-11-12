/*
 * 中文导读：线路与语音外呼：call-limits.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {z} from 'zod';

// Zero is an explicit absence of a system quota. Positive limits are set by a
// system administrator; provider capacity is independent of these policies.
export const callLimitSchema=z.number().int().nonnegative().default(0);

export function withinCallLimit(limit:number,used:number,requested=1){
 return limit===0||used+requested<=limit;
}
