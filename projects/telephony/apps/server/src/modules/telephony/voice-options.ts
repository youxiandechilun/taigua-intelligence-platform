/*
 * 中文导读：可供当前账号使用的声音候选与访问范围。
 */
import { presets } from './models.service.js';

export type CallVoiceProvider = 'HAOKEHU_SIP' | 'ALIYUN_ENGINE';
export type CallVoiceOption = {
 key: string; name: string; model: string; voice: string; voiceId: string;
 gender: 'neutral' | 'female' | 'male'; kind: 'builtin' | 'clone' | 'cloud';
 available: boolean; reason: string; hasPreview: boolean;
};
export function builtinVoiceOptions(model: string) {
 const preset=presets.find(p=>p.id===model&&p.kind==='realtime');
 if(!preset)return [];
 const builtins='voices' in preset?preset.voices:[];
 return builtins.map(v=>({...v,gender:('gender' in v?v.gender:/男/.test(v.name)?'male':/女|姐姐/.test(v.name)?'female':'neutral') as CallVoiceOption['gender']}));
}
export function voiceAccessible(row:{employeeVisible?:boolean;assignedUserIds?:string[]},userId:string){
 return row.employeeVisible===true&&(!row.assignedUserIds?.length||row.assignedUserIds.includes(userId));
}
export function safeAuditionUrl(raw:string){
 try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&['aliyuncs.com','alicdn.com','aliyun.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))?u.toString():'';}catch{return '';}
}
