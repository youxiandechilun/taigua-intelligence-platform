/*
 * 中文导读：按人物冻结音色、音量、表达和合成参数，避免切换开场录音后混用另一人物的配置。
 */
import type {CrmDb,Row,Scope} from '../crm/crm.service.js';
import {effectiveVoiceTuning} from './voice-tuning.js';
import {voiceExpressionInstructions} from './voice-delivery-policy.js';
import {voiceReferenceExpression} from './voice-reference-expression.js';
import {credentialScope} from './model-credentials.js';
import {effectiveSpeechSynthesis,speechSynthesisRequest} from './voice-synthesis.js';
import {synthesisDeliveryVersion} from './voice-synthesis-delivery.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
/* 中文注释：为指定声音人物合并调教、参考表达和合成参数，写入本通电话的配置快照。 */


// All fields here describe one speaker. Freeze each selectable speaker instead
// of reusing the first speaker's settings after selecting another opening.
export async function freezeCallVoiceConfiguration(s:Scope,sound:Row,baseAudio:Row,db:CrmDb,opening?:Row){
 const tuning=await effectiveVoiceTuning(s.workspaceId,sound.voiceId||'',db);
 const reference=opening&&opening.voiceId===sound.voiceId&&typeof opening.text==='string'&&Number(opening.durationSeconds)>0
  ? voiceReferenceExpression({text:opening.text,durationSeconds:Number(opening.durationSeconds),analysis:opening.analysis}) : '';
 const synthesis=effectiveSpeechSynthesis(sound.model,sound.voice,tuning.settings,{voiceId:sound.voiceId,credentialScope:credentialScope(s.workspaceId)});
 return {version:synthesisDeliveryVersion,voiceId:sound.voiceId||'',sourceModel:sound.model,sourceVoice:sound.voice,gender:sound.gender,
  audio:{...baseAudio,...tuning.audio,volume:tuning.volume},volume:tuning.volume,
  voiceExpression:voiceExpressionInstructions(tuning.settings)+reference,
  voiceTuning:{voiceId:sound.voiceId||'',updatedAt:tuning.updatedAt,source:tuning.source},
  speechSynthesis:speechSynthesisRequest(synthesis)};
}
/* 中文注释：确认声音版本、人物和模型参数一致，发现混用时拒绝继续。 */

export function assertCallVoiceConfiguration(value:Row,sound:Row){
 if(value.version!==synthesisDeliveryVersion||value.voiceId!==(sound.voiceId||'')||value.sourceModel!==sound.model||value.sourceVoice!==sound.voice)throw new BadRequestError('开场人物与声音调教配置不一致，请重新核对任务。');
 if(value.speechSynthesis&&(value.speechSynthesis.voiceId!==sound.voiceId||value.speechSynthesis.sourceModel!==sound.model||value.speechSynthesis.sourceVoice!==sound.voice))throw new BadRequestError('开场人物与语音合成配置不一致，请重新核对任务。');
}
