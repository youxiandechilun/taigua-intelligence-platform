/*
 * 中文导读：数字员工与话术：script-recording-schema.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { z } from 'zod';
export const recordingRepliesSchema=z.object({version:z.literal(1),voiceId:z.string().uuid().optional(),openingSource:z.enum(['library','generated']).optional(),entries:z.record(
 z.string().regex(/^(opening-recordings|(?:step|node|faq|objection):.{1,100})$/),
 z.object({mode:z.enum(['recording-first','ai']),clips:z.array(z.object({assetId:z.string().uuid(),voiceId:z.string().uuid().optional(),textHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(20),direct:z.boolean().optional(),phrases:z.array(z.string().trim().min(2).max(200)).max(20).optional(),openingPlayback:z.enum(['random','fixed']).optional(),selectedOpeningId:z.string().uuid().optional()}).strict()
).refine(v=>Object.keys(v).length<=250)}).strict();

export function hasOpeningRecording(p:{recordingReplies?:z.infer<typeof recordingRepliesSchema>}){
 if(p.recordingReplies?.openingSource==='library')return !!p.recordingReplies.voiceId;
 const entry=p.recordingReplies?.entries['opening-recordings'];
 return !!entry&&entry.mode!=='ai'&&entry.clips.some(c=>!!(c.voiceId||p.recordingReplies?.voiceId)&&(entry.openingPlayback!=='fixed'||c.assetId===entry.selectedOpeningId));
}
