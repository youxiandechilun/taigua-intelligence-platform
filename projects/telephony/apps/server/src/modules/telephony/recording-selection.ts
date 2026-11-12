/*
 * 中文导读：根据通话尝试编号稳定选择开场录音，并限制后续录音使用同一人物的声音。
 */
import {createHash} from 'node:crypto';
import {CALL_VOICE_MODEL} from './voice-model-policy.js';
import type {Row} from '../crm/crm.service.js';
export class RecordingVoiceMismatchError extends Error {}
/* 中文注释：用尝试编号的哈希稳定选择开场；整通电话只保留所选人物的录音与模型声音。 */

// Selection happens before opening the model session. Both playback and AI then
// use this one speaker for the whole call, including retries of the same attempt.
export function selectCallRecordings(snapshot:Row,attemptId:string){
 const all:Row[]=snapshot.recordings||[];
 const openings=all.filter(c=>c.key==='opening-recordings');
 const opening=openings.length?openings[createHash('sha256').update(attemptId).digest().readUInt32BE(0)%openings.length]:undefined;
 if(opening&&(typeof opening.voiceId!=='string'||!opening.voiceId.trim()))throw new RecordingVoiceMismatchError('开场录音尚未绑定声音库人物，请先关联本人复刻声音。');
 const voiceId=opening?.voiceId||snapshot.voiceId;
 const sound=snapshot.recordingVoices?.[voiceId]||snapshot.employeeVoice;
 if(opening&&(sound?.voiceId!==voiceId||sound?.model!==CALL_VOICE_MODEL||typeof sound?.voice!=='string'||!sound.voice.trim()))throw new RecordingVoiceMismatchError('开场录音缺少可用的本人复刻声音，请重新关联并创建任务，系统不会替换成默认音色。');
 return {opening,sound,recordings:all.filter(c=>c.key==='opening-recordings'?c.assetId===opening?.assetId:c.voiceId===voiceId)};
}
