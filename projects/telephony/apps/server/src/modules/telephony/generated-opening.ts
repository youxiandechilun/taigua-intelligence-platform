/*
 * 中文导读：线路与语音外呼：generated-opening.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {z} from 'zod';
import {type Scope,memberAccess} from '../crm/crm.service.js';
import {crmDb} from '../crm/crm.db.js';
import prisma from '../../config/prisma.js';
import {canTrain,publishedRelease} from '../agent/agent.release.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {NotFoundError} from '../../common/errors/notFound.js';
import {generateVoicePreview} from './employee-voice-preview.js';
import {recordingScope,uploadRecording} from './script-recordings.js';
import {readyVoiceOpening} from './voice-opening-store.js';
import {telephoneOpening} from './voice-opening-audio.js';
import {sipProfileSchema} from './sip.schema.js';
import {recordAuditEvent} from '../audit/audit-log.service.js';
import {requireScriptManager} from '../agent/script-access.js';

const input=z.object({scope:recordingScope,voiceId:z.string().uuid(),text:z.string().trim().min(1,'请填写开场白。').max(300,'开场白最多300字。').refine(value=>!value.includes('{{'),'生成开场白前请先填写文字中的变量。'),requestId:z.string().uuid(),retryOf:z.string().uuid().optional(),confirmed:z.literal(true)}).strict();

// A generated greeting is a private, immutable script asset, rather than a
// mutable voice-library opening. Replaying or saving it cannot invoke TTS.
export async function generateOpening(s:Scope,agentId:string,raw:unknown){return generateScriptAudio(s,agentId,raw,false);}
export async function generateAnswer(s:Scope,agentId:string,raw:unknown){return generateScriptAudio(s,agentId,raw,true);}
async function generateScriptAudio(s:Scope,agentId:string,raw:unknown,answer:boolean){
 const data=(answer?input.extend({text:z.string().trim().min(1,'请填写回答。').max(300,'生成录音的回答最多300字。').refine(value=>!value.includes('{{'),'请先填写回答中的变量。')}):input).parse(raw),access=await memberAccess(crmDb,s);
 await requireScriptManager(s);
 if(data.scope==='personal')throw new ForbiddenError('话术录音由管理员在统一话术中生成。');
 let language:unknown='zh-CN';
 if(data.scope==='template'){
  if(!canTrain(access.permissions))throw new ForbiddenError('没有培训话术编辑权限。');
  if(!await prisma.agent.findFirst({where:{agentId,organizationId:s.workspaceId,deletionRequestedAt:null},select:{agentId:true}}))throw new NotFoundError('数字员工不存在。');
  language=(await crmDb.query('SELECT "profile" FROM "SipAgentProfile" WHERE "workspaceId"=$1 AND "agentId"=$2',[s.workspaceId,agentId]))[0]?.profile?.language||'zh-CN';
 }else language=(await publishedRelease(s,agentId)).snapshot?.profile?.language||'zh-CN';
 await readyVoiceOpening(s,data.voiceId);
 const profile=sipProfileSchema.parse({voiceId:data.voiceId,language});
 const preview=await generateVoicePreview(s,agentId,{profile,text:data.text,requestId:data.requestId,retryOf:data.retryOf,confirmed:true});
 if(preview.status!=='READY'||!preview.audio)return {...preview,audio:null};
 const generated=Buffer.from(preview.audio,'base64');
 // Existing synthesis returns mono PCM WAV. Inspect before reading header fields.
 if(generated.length<44||generated.length>8*1024*1024||generated.toString('ascii',0,4)!=='RIFF'||generated.toString('ascii',8,16)!=='WAVEfmt '||generated.readUInt32LE(16)!==16||generated.readUInt16LE(20)!==1||generated.readUInt16LE(22)!==1||generated.readUInt16LE(34)!==16)throw new BadRequestError('生成音频格式异常，请联系管理员核对。');
 const rate=generated.readUInt32LE(24);
 if(rate<16000||rate>48000)throw new BadRequestError('生成音频采样率暂不支持。');
 if(generated.length-44>rate*2*45)throw new BadRequestError('生成的开场白超过45秒，请缩短文字后重新生成。');
 const audio=telephoneOpening(generated,rate);
 const asset=await uploadRecording(s,agentId,{scope:data.scope,voiceId:data.voiceId,text:data.text,fileName:answer?'文字生成回答.wav':'文字生成开场白.wav',audio:audio.toString('base64')});
 if(!asset)throw new BadRequestError('开场白保存失败，请重新查询生成结果。');
 await recordAuditEvent({organizationId:s.workspaceId,userId:s.userId,action:answer?'agent.answer.generated':'agent.opening.generated',resourceType:'agent',resourceId:agentId,metadata:{assetId:asset.id,voiceId:data.voiceId,cached:preview.cached}});
 return {...preview,audio:audio.toString('base64'),asset:{...asset,voiceId:data.voiceId}};
}
