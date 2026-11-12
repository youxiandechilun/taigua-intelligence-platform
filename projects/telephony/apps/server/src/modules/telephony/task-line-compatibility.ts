/*
 * 中文导读：线路与语音外呼：task-line-compatibility.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { lineSchema } from './sip.schema.js';

// Scheduling, pricing, quotas and display names follow the administrator's current settings.
// Gateway, caller and recipient routing remain bound to the originally confirmed task.
const identityKeys = ['serviceProvider','trunkKey','serverIp','port','transport','callerMode','callerNumber','prefix','employeePrefix','codecs'] as const;
// A redial override binds the confirmed gateway/caller without copying private
// line settings into the attempt's public result payload.
export function taskLineIdentity(line: unknown) {
  const value = lineSchema.parse(line);
  return createHash('sha256').update(JSON.stringify(identityKeys.map(key => value[key]))).digest('hex');
}
export function sameTaskLine(saved: unknown, current: unknown) {
  const a=lineSchema.safeParse(saved), b=lineSchema.safeParse(current);
  return a.success && b.success && identityKeys.every(key=>isDeepStrictEqual(a.data[key],b.data[key]));
}
export function sameTaskRoutes(saved: unknown, current: Array<{line:unknown;lineId:string;province:string}>) {
  return Array.isArray(saved) && saved.length===current.length && saved.every((route,index)=>{
    const other=current[index];
    return route && other && route.lineId===other.lineId && route.province===other.province && sameTaskLine(route.line,other.line);
  });
}
