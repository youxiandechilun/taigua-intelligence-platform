/*
 * 中文导读：线路与语音外呼：models.service.ts。实现可供接口或后台任务调用的业务操作。
 */
import {configurationRevision,assertConfigurationRevision} from '../workspace/config-revision.js';
import {voiceDeliverySchema} from './voice-delivery-policy.js';
import {realtimeBuiltinVoices} from './realtime-voices.js';
import {blockedBuiltinVoices} from './voice-management.js';
import {modelKey,credentialStatus} from './model-credentials.js';
import {connectivity,testConnectivity} from './model-connectivity.js';
import { z } from 'zod';
import prisma from '../../config/prisma.js';
import { crmDb } from '../crm/crm.db.js';
import { companyContext } from '../workspace/company-access.js';
import { type Scope, type CrmDb } from '../crm/crm.service.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { platformConfiguration, platformEnabled } from '../platform/platform-client.js';

// Endpoints and environment names are fixed server-side. No user supplied URL
// can forward a platform credential or reach the private network.
export const presets = [
 { id:'qwen-plus',name:'通义千问 Plus',vendor:'阿里云百炼',kind:'text',key:'DASHSCOPE_API_KEY',base:'https://dashscope.aliyuncs.com/compatible-mode/v1' },
 { id:'qwen-turbo',name:'通义千问 Turbo',vendor:'阿里云百炼',kind:'text',key:'DASHSCOPE_API_KEY',base:'https://dashscope.aliyuncs.com/compatible-mode/v1' },
 { id:'qwen-max',name:'通义千问 Max',vendor:'阿里云百炼',kind:'text',key:'DASHSCOPE_API_KEY',base:'https://dashscope.aliyuncs.com/compatible-mode/v1' },
 { id:'step-3.5-flash',name:'阶跃星辰 3.5 Flash',vendor:'阶跃星辰',kind:'text',key:'STEPFUN_API_KEY',base:'https://api.stepfun.com/v1' },
 { id:'step-3.7-flash',name:'阶跃星辰 3.7 Flash',vendor:'阶跃星辰',kind:'text',key:'STEPFUN_API_KEY',base:'https://api.stepfun.com/v1' },
 { id:'step-5-preview',name:'阶跃星辰 5（预览版）',vendor:'阶跃星辰',kind:'text',key:'STEPFUN_API_KEY',base:'https://api.stepfun.com/v1' },
 { id:'stepaudio-2.5-realtime',name:'阶跃星辰实时语音 2.5',vendor:'阶跃星辰',kind:'realtime',key:'STEPFUN_API_KEY',base:'wss://api.stepfun.com/v1/realtime',voices:[{id:'qingchunshaonv',name:'青春女声'},{id:'wenrounansheng',name:'温柔男声'}] },
 { id:'step-1o-audio',name:'阶跃星辰实时语音 1o',vendor:'阶跃星辰',kind:'realtime',key:'STEPFUN_API_KEY',base:'wss://api.stepfun.com/v1/realtime',voices:[{id:'linjiajiejie',name:'邻家姐姐'},{id:'jingdiannvsheng',name:'经典女声'},{id:'cixingnansheng',name:'磁性男声'},{id:'boyinnansheng',name:'播音男声'}] },
 { id:'deepseek-chat',name:'DeepSeek 对话',vendor:'深度求索',kind:'text',key:'DEEPSEEK_API_KEY',base:'https://api.deepseek.com/v1' },
 { id:'glm-4-plus',name:'智谱 GLM 4 Plus',vendor:'智谱',kind:'text',key:'ZHIPU_API_KEY',base:'https://open.bigmodel.cn/api/paas/v4' },
 ...(['qwen3.8-omni-flash-realtime','qwen3.5-omni-plus-realtime','qwen3.5-omni-flash-realtime'] as const).map(id=>({id,name:id==='qwen3.8-omni-flash-realtime'?'通义千问全模态 3.8（支持复刻声音）':id==='qwen3.5-omni-plus-realtime'?'通义千问全模态 3.5 增强版':'通义千问全模态 3.5 快速版',vendor:'阿里云百炼',kind:'realtime' as const,key:'DASHSCOPE_API_KEY',base:'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',voices:realtimeBuiltinVoices[id]||[]})),
 { id:'qwen-audio-3.1-realtime-plus',name:'通义千问实时语音',vendor:'阿里云百炼',kind:'realtime',key:'DASHSCOPE_API_KEY',base:'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',voices:realtimeBuiltinVoices['qwen-audio-3.1-realtime-plus']||[] },
] as const;
const ids=presets.map(p=>p.id);
const configSchema=z.object({voiceDelivery:voiceDeliverySchema.optional(),enabled:z.array(z.string().refine(v=>ids.includes(v as typeof ids[number]))).max(20).default([]),summaryModel:z.string().default('')}).strict().refine(v=>!v.summaryModel||v.enabled.includes(v.summaryModel)&&presets.some(p=>p.id===v.summaryModel&&p.kind==='text'),'整理模型必须是已授权的文字模型');
// Operations are administrator-only storage and are never accepted by saveModels.
function modelSettingsFromStored(value:unknown){const raw=value&&typeof value==='object'&&!Array.isArray(value)?{...value as Record<string,unknown>}:{};delete raw.voiceOperations;delete raw.testNumberWhitelist;return configSchema.parse(raw);}
async function saved(workspaceId:string){
 const row=(await crmDb.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[workspaceId]))[0];
 const stored=modelSettingsFromStored(row?.settings||{});
 if(!platformEnabled())return stored;
 const {model,telephony}=await platformConfiguration();
 const centralized=[...(model.enabled?['qwen-plus']:[]),...(telephony.enabled&&telephony.realtime_model?[telephony.realtime_model]:[])].filter(id=>ids.includes(id as typeof ids[number]));
 return {...stored,enabled:[...new Set([...stored.enabled,...centralized])],summaryModel:model.enabled?'qwen-plus':stored.summaryModel};
}
export async function catalog(s:Scope){
 const [context,config,blocked]=await Promise.all([companyContext(s.workspaceId,s.userId),saved(s.workspaceId),blockedBuiltinVoices(s.workspaceId)]);
 return {revision:configurationRevision(config),voiceManagementVersion:1,canConfigure:context.isSystemAdmin,canManage:context.canManage,summaryModel:config.summaryModel,credentials:context.isSystemAdmin?await credentialStatus(s.workspaceId):[],models:await Promise.all(presets.filter(p=>context.isSystemAdmin||config.enabled.includes(p.id)).map(async p=>{const key=await modelKey(s.workspaceId,p.key).catch(()=>'');return {id:p.id,name:p.name,vendor:p.vendor,kind:p.kind,enabled:config.enabled.includes(p.id),configured:!!key,voices:'voices' in p?p.voices.filter(v=>!blocked.has(p.id+'\0'+v.id)):[],...await connectivity(s.workspaceId,p,key)};}))};
}
export async function testModel(s:Scope,modelId:string){const preset=presets.find(p=>p.id===modelId);if(!preset)throw new BadRequestError('模型不存在。');return testConnectivity(s,preset);}
export async function saveModels(s:Scope,input:unknown){
 if(!(await companyContext(s.workspaceId,s.userId)).isSystemAdmin)throw new ForbiddenError('模型服务由系统超级管理员配置。');
 const {expectedRevision,...draft}=z.object({expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).passthrough().parse(input);
 const data=configSchema.parse(draft);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['workspace-model-settings:'+s.workspaceId]);
  const current=(await db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[s.workspaceId]))[0];
  assertConfigurationRevision(expectedRevision,modelSettingsFromStored(current?.settings||{}));
 await db.query('INSERT INTO "WorkspaceModelSettings" ("workspaceId","settings") VALUES ($1,$2::jsonb) ON CONFLICT ("workspaceId") DO UPDATE SET "settings"="WorkspaceModelSettings"."settings" || EXCLUDED."settings","updatedAt"=NOW() RETURNING "workspaceId"',[s.workspaceId,JSON.stringify(data)]);
 });
 await prisma.auditLog.create({data:{organizationId:s.workspaceId,userId:s.userId,action:'MODEL_SERVICES_UPDATED',resourceType:'WorkspaceModelSettings',resourceId:s.workspaceId,metadata:{enabled:data.enabled}}});
 return catalog(s);
}
export async function selection(s:Scope,agentId:string){
 if(!await prisma.agent.findFirst({where:{organizationId:s.workspaceId,agentId,deletionRequestedAt:null},select:{agentId:true}}))throw new BadRequestError('数字员工不存在。');
 const row=(await crmDb.query('SELECT "modelId" FROM "AgentModelSelection" WHERE "workspaceId"=$1 AND "agentId"=$2',[s.workspaceId,agentId]))[0];return {modelId:row?.modelId||''};
}
export async function saveSelection(s:Scope,agentId:string,input:unknown){
 if(!(await companyContext(s.workspaceId,s.userId)).permissions.agentConfiguration?.includes('update'))throw new ForbiddenError('请由获授权的负责人选择模型。');
 await selection(s,agentId);const data=z.object({modelId:z.string()}).strict().parse(input),config=await saved(s.workspaceId);
 if(data.modelId&&(!config.enabled.includes(data.modelId)||!presets.some(p=>p.id===data.modelId&&p.kind==='text')))throw new BadRequestError('请选择已授权的文字模型。');
 await crmDb.query('INSERT INTO "AgentModelSelection" ("workspaceId","agentId","modelId") VALUES ($1,$2,$3) ON CONFLICT ("workspaceId","agentId") DO UPDATE SET "modelId"=EXCLUDED."modelId","updatedAt"=NOW() RETURNING "agentId"',[s.workspaceId,agentId,data.modelId]);return data;
}
export async function textConnection(workspaceId:string,agentId:string|null,purpose:'rehearsal'|'summary',legacy:{key:string;model:string;base:string}){
 if(platformEnabled()){
  const {model}=await platformConfiguration();
  if(!model.enabled||!model.base_url||!model.api_key||!model.model)throw new BadRequestError('请在主页后台启用并配置文字模型。');
  return {key:model.api_key,model:model.model,base:model.base_url.replace(/\/$/,'')};
 }
 const config=await saved(workspaceId);let chosen=purpose==='summary'?config.summaryModel:'';
 if(purpose==='rehearsal'&&agentId)chosen=(await crmDb.query('SELECT "modelId" FROM "AgentModelSelection" WHERE "workspaceId"=$1 AND "agentId"=$2',[workspaceId,agentId]))[0]?.modelId||'';
 if(!chosen)return legacy;
 const preset=presets.find(p=>p.id===chosen&&p.kind==='text');
 if(!preset||!config.enabled.includes(chosen))throw new BadRequestError('所选模型授权已变化，请联系管理员重新选择。');
 const key=await modelKey(workspaceId,preset.key);if(!key)throw new BadRequestError('所选模型尚未配置密钥，请联系系统管理员。');
 return {key,model:preset.id,base:preset.base};
}

export async function realtimeAuthorized(workspaceId:string,modelId:string,db:CrmDb=crmDb){
 if(platformEnabled()){
  const {telephony}=await platformConfiguration();
  if(!telephony.enabled||!telephony.api_key)throw new BadRequestError('请在主页后台配置并启用语音模型。');
  if(telephony.realtime_model&&telephony.realtime_model!==modelId)throw new BadRequestError('所选语音模型与主页配置不一致，请更新数字员工。');
  return;
 }
 const row=(await db.query('SELECT "settings" FROM "WorkspaceModelSettings" WHERE "workspaceId"=$1',[workspaceId]))[0];
 if(!row || !modelSettingsFromStored(row.settings).enabled.includes(modelId))throw new BadRequestError('当前实时语音模型尚未授权，请由系统管理员在大模型配置中授权。');
 const preset=presets.find(p=>p.kind==='realtime'&&p.id===modelId);
 if(!preset||!await modelKey(workspaceId,preset.key))throw new BadRequestError('实时语音模型尚未配置，请联系系统管理员。');
}
