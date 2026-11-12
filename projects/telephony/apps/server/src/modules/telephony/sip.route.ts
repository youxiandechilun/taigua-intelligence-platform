/*
 * 中文导读：线路与语音外呼：sip.route.ts。声明接口路径、中间件和处理函数。
 */
import { openingInterruptionRules, openingInterruptionRulesSchema, saveOpeningInterruptionRules, openingRulesRevision, classifyOpeningSpeech } from './opening-interruption-rules.js';
import {generateOpening,generateAnswer} from './generated-opening.js';
import * as voiceOpenings from './voice-opening.service.js';
import demoRouter from './demo.route.js';
import {liveHandoff} from './live-handoff.js';
import * as voiceTraining from './voice-training.js';
import {renderVoiceAudition} from './voice-render.js';
import * as voiceTuning from './voice-tuning.js';
import {voiceOpeningAudio,cachedVoicePreview} from './voice-opening-store.js';
import {voiceDeliverySettings,saveVoiceDelivery} from './voice-delivery-policy.js';
import {voiceOperationsCatalog,saveVoiceOperations} from './voice-operations.service.js';
import {lineFailureHistory} from './line-failures.service.js';
import {testNumberWhitelistCatalog,createTestNumberWhitelistItem,updateTestNumberWhitelistItem,deleteTestNumberWhitelistItem} from './test-number-whitelist.service.js';
import {uploadRecording,recordingAudio,attemptRecording} from './script-recordings.js';
import {cloneOpeningVoice} from './opening-voice.js';
import {startTestCall,testCallStatus,discardTestCallDraft} from './test-calls.js';
import {callerCatalog} from './caller-catalog.js';
import {serviceProviders,createServiceProvider} from './service-providers.js';
import {attemptKnowledge} from '../kb/knowledge-retrieval.js';
import { canTrain,canPublish } from '../agent/agent.release.js';
import { engineGateway, authenticateEngine } from './aliyun-engine.gateway.js';
import { enqueueEngineReceipts } from './aliyun-engine.receipts.js';
import * as engine from './aliyun-engine.service.js';
import * as capacity from './call-capacity.js';
import { outboundParallelismPolicy, saveOutboundParallelismPolicy } from './outbound-parallelism.service.js';
import * as callback from './callback.settings.js';
import {openCallbackRecording} from './callback.recording.js';
import {recordingHosts} from './callback.events.js';
import {callVisibleSql} from '../workspace/company-policy.js';
import {saveCredential,readCredential} from './model-credentials.js';
import { Router } from 'express';
import { z } from 'zod';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import authMiddleware from '../../middleware/auth.middleware.js';
import { authorized, requirePermission } from '../../middleware/authorize.middleware.js';
import { trustedOrigins } from '../../config/origins.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import { taskValidationError } from './task-validation.js';
import {taskPageSchema} from './task-query.js';
import {taskControlStatus,pauseAllTasks,resumeAllTasks} from './task-bulk-control.js';
import { crmDb } from '../crm/crm.db.js';
import { memberAccess, type Scope } from '../crm/crm.service.js';
import { eventSchema } from './sip.schema.js';
import { ingestLiveIntent, intentRules, liveIntentInputSchema, matchIntent, mutateIntentRules, assistantDetectionRules, assistantDetectionRulesSchema, evaluateAssistantDetection, saveAssistantDetectionRules, assistantRulesRevision } from '../crm/intent-recognition.js';
import { recordAuditEvent } from '../audit/audit-log.service.js';
import * as service from './sip.service.js';
import * as models from './models.service.js';
import * as modelUsage from './model-usage.service.js';
import * as manual from './manual.service.js';
import * as routing from './routing.service.js';
import * as voices from './voices.service.js';
import {employeeVoicePreview} from './employee-voice-preview.js';
import * as personalVoice from './personal-voice.service.js';
import {syncEngineVoices} from './engine-voices.service.js';
const router=Router();
const id=z.string().uuid();
const managedLineId=z.union([id,z.literal('haokehu-default')]);
const preparedDemoAccess=(method:string,path:string)=>
  (method==='GET'&&/^\/agents\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/demo$/.test(path))||
  (method==='POST'&&/^\/agents\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/demo-preview$/.test(path));
router.post('/aliyun-engine/gateway',async(req,res,next)=>{try{await engineGateway(req,res);}catch(e){if(res.headersSent)res.end();else next(e);}});
router.post('/aliyun-engine/receipts',async(req,res,next)=>{try{authenticateEngine(req,'RECEIPT');await enqueueEngineReceipts(req.body);res.json({code:0,msg:'接收成功'});}catch(e){next(e);}});
function authenticateBridge(req:import('express').Request){
  const token=process.env.SIP_BRIDGE_TOKEN;
  const timestamp=req.get('x-sip-timestamp') || '';
  const signature=req.get('x-sip-signature') || '';
  if (!token || !/^\d{13}$/.test(timestamp) || Math.abs(Date.now()-Number(timestamp))>5*60000 || !/^[a-f0-9]{64}$/.test(signature)) throw new ForbiddenError('通话事件认证失败。');
  const expected=createHmac('sha256',token).update(timestamp+':').update((req as typeof req & {sipRawBody?:Buffer}).sipRawBody || Buffer.from(JSON.stringify(req.body))).digest();
  if (!timingSafeEqual(expected,Buffer.from(signature,'hex'))) throw new ForbiddenError('通话事件认证失败。');
}
router.post('/handoff',async(req,res,next)=>{try{authenticateBridge(req);res.json({success:true,data:await liveHandoff(req.body)});}catch(e){next(e);}});
router.post('/knowledge/search',async(req,res,next)=>{
 try{
  authenticateBridge(req);
  const input=z.object({attemptId:z.string().uuid(),query:z.string().trim().min(2).max(1200)}).strict().parse(req.body);
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await attemptKnowledge(input.attemptId,input.query)});
 }catch(e){next(e);}
});
router.post('/script-recordings/audio',async(req,res,next)=>{try{authenticateBridge(req);const data=z.object({attemptId:id,assetId:id}).strict().parse(req.body);res.setHeader('Cache-Control','private, no-store');res.type('audio/wav').send(await attemptRecording(data.attemptId,data.assetId));}catch(e){next(e);}});
router.post('/events',async(req,res,next)=>{
 try {
  authenticateBridge(req);
  const event=eventSchema.parse(req.body);
  if (Date.parse(event.occurredAt)>Date.now()+60000) throw new BadRequestError('通话事件时间不正确。');
  res.json({success:true,data:await service.ingestEvent(crmDb,event)});
 }catch(e){next(e);}
});
router.post('/live-transcript',async(req,res,next)=>{
 try {
  authenticateBridge(req);
  const input=liveIntentInputSchema.parse(req.body);
  if (Date.parse(input.timestamp)>Date.now()+60000) throw new BadRequestError('实时转写时间不正确。');
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await ingestLiveIntent(crmDb,input)});
 }catch(e){next(e);}
});
router.use(authMiddleware,requirePermission({}),authorized(async(req,res,next)=>{
 if(req.auth.authMethod!=='session')throw new ForbiddenError('请登录系统后使用线路功能。');
 if(req.get('x-workspace-id')&&req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('工作区已切换，请刷新后操作。');
 if(req.method!=='GET'&&(!trustedOrigins.includes(req.get('origin') || '')||req.get('x-workspace-id')!==req.auth.activeOrganizationId))throw new ForbiddenError('请在当前工作区页面提交。');
 await memberAccess(crmDb,{workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
 res.setHeader('Cache-Control','private, no-store');next();
}));
const intentRuleUiSchema=z.object({
 id:z.string().trim().min(1).max(80).optional(),
 name:z.string().trim().min(1).max(120),
 intent:z.enum(['interested','unclear','uninterested','optout']),
 positiveKeywords:z.array(z.string().trim().min(1).max(80)),
 negativeKeywords:z.array(z.string().trim().min(1).max(80)).default([]),
 matchMode:z.enum(['any','all','phrase']).default('any'),
 priority:z.number().int().min(0).max(1000).default(100),
 enabled:z.boolean().default(true),
 applyTo:z.array(z.enum(['outbound','demo','manual','assistant'])).max(4).default(['outbound','demo','manual','assistant']),
 replyHint:z.string().trim().max(500).nullable().optional(),
 action:z.string().trim().max(200).nullable().optional(),
}).strict();
const toUiRule=(rule:any)=>({id:rule.id,name:rule.name,intent:rule.intent,positiveKeywords:rule.positiveKeywords?.length?rule.positiveKeywords:rule.keywords||[],negativeKeywords:rule.negativeKeywords||[],matchMode:rule.matchMode||'any',priority:rule.priority??100,enabled:rule.enabled!==false,applyTo:rule.applyTo?.length?rule.applyTo:['outbound','demo','manual','assistant'],replyHint:rule.replyHint??'',action:rule.action??''});
const toStoredRule=(input:any,id:string)=>({id,name:input.name,intent:input.intent,keywords:input.positiveKeywords,positiveKeywords:input.positiveKeywords,negativeKeywords:input.negativeKeywords||[],matchMode:input.matchMode||'any',priority:input.priority??100,enabled:input.enabled!==false,applyTo:input.applyTo?.length?input.applyTo:['outbound','demo','manual','assistant'],replyHint:input.replyHint??'',action:input.action??''});
async function saveUiRule(req:any,input:any,id?:string){
 const stored=toStoredRule(input,id||input.id||randomUUID());
 return mutateIntentRules(crmDb,req.auth.activeOrganizationId,current=>{
  const editId=id||input.id;
  if(editId&&!current.some(rule=>rule.id===editId))throw new BadRequestError('规则不存在，请刷新后重试。');
  return editId?current.map(rule=>rule.id===editId?stored:rule):[...current,stored];
 });
}
router.get('/line-failures',requirePermission({callLogs:['read']}),authorized(async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 res.json({success:true,data:await lineFailureHistory({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId},req.query)});
}));
router.get('/intent-rules',requirePermission({lines:['read']}),authorized(async(req,res)=>{
 const rules=await intentRules(crmDb,req.auth.activeOrganizationId);
 res.json({success:true,data:rules.map(toUiRule)});
}));
router.post('/intent-rules',requirePermission({lines:['assign']}),authorized(async(req,res)=>{
 const input=intentRuleUiSchema.omit({id:true}).parse(req.body);
 const rules=await saveUiRule(req,input);
 await recordAuditEvent({organizationId:req.auth.activeOrganizationId,userId:req.auth.userId,action:'calls.intent_rules.created',resourceType:'WorkspaceCallPolicy',resourceId:req.auth.activeOrganizationId,metadata:{count:rules.length}});
 res.json({success:true,data:toUiRule(rules[ rules.length-1 ])});
}));
router.put('/intent-rules/:ruleId',requirePermission({lines:['assign']}),authorized(async(req,res)=>{
 const input=intentRuleUiSchema.omit({id:true}).parse(req.body);
 const rules=await saveUiRule(req,input,String(req.params.ruleId));
 await recordAuditEvent({organizationId:req.auth.activeOrganizationId,userId:req.auth.userId,action:'calls.intent_rules.updated',resourceType:'WorkspaceCallPolicy',resourceId:String(req.params.ruleId),metadata:{count:rules.length}});
 res.json({success:true,data:toUiRule(rules.find(rule=>rule.id===String(req.params.ruleId)))});
}));
router.delete('/intent-rules/:ruleId',requirePermission({lines:['assign']}),authorized(async(req,res)=>{
 const next=await mutateIntentRules(crmDb,req.auth.activeOrganizationId,current=>{
  const filtered=current.filter(rule=>rule.id!==String(req.params.ruleId));
  if(filtered.length===current.length)throw new BadRequestError('规则不存在，请刷新后重试。');
  return filtered;
 });
 await recordAuditEvent({organizationId:req.auth.activeOrganizationId,userId:req.auth.userId,action:'calls.intent_rules.deleted',resourceType:'WorkspaceCallPolicy',resourceId:String(req.params.ruleId),metadata:{count:next.length}});
 res.json({success:true,data:null});
}));
router.post('/intent-rules/test',requirePermission({lines:['read']}),authorized(async(req,res)=>{
 const input=z.object({text:z.string().trim().min(1).max(6000)}).strict().parse(req.body);
 const matched=matchIntent(input.text,await intentRules(crmDb,req.auth.activeOrganizationId));
 res.json({success:true,data:{text:input.text,matched:!!matched,intent:matched?.intent||null,rules:matched?.rules||[],evidence:matched?[matched.evidence]:[]}});
}));
router.get('/opening-interruption-rules',requirePermission({lines:['read']}),authorized(async(req,res)=>{
 const access=await memberAccess(crmDb,{workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
 const rules=await openingInterruptionRules(crmDb,req.auth.activeOrganizationId);
 res.json({success:true,data:{rules,revision:openingRulesRevision(rules),canWrite:access.isSystemAdmin||access.permissions.lines?.includes('assign')===true}});
}));
router.put('/opening-interruption-rules',requirePermission({lines:['assign']}),authorized(async(req,res)=>{
 const input=z.object({rules:openingInterruptionRulesSchema,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
 const rules=await saveOpeningInterruptionRules(crmDb,req.auth.activeOrganizationId,input.rules,input.expectedRevision);
 await recordAuditEvent({organizationId:req.auth.activeOrganizationId,userId:req.auth.userId,action:'calls.opening_interruption_rules.updated',resourceType:'WorkspaceCallPolicy',resourceId:req.auth.activeOrganizationId,metadata:{lockOpening:rules.lockOpening,acknowledgementCount:rules.acknowledgementKeywords.length,interruptCount:rules.interruptKeywords.length}});
 res.json({success:true,data:{rules,revision:openingRulesRevision(rules),canWrite:true}});
}));
router.post('/opening-interruption-rules/test',requirePermission({lines:['read']}),authorized(async(req,res)=>{
 const input=z.object({text:z.string().trim().min(1).max(6000)}).strict().parse(req.body);
 const rules=await openingInterruptionRules(crmDb,req.auth.activeOrganizationId);
 const result=classifyOpeningSpeech(input.text,rules);
 res.json({success:true,data:{...result,lockOpening:rules.lockOpening,action:result.substantive?(rules.lockOpening?'answer_after_opening':'interrupt_and_answer'):'continue_opening'}});
}));
router.get('/assistant-detection-rules',requirePermission({lines:['read']}),authorized(async(req,res)=>{
 const access=await memberAccess(crmDb,{workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
 const rules=await assistantDetectionRules(crmDb,req.auth.activeOrganizationId);
 res.json({success:true,data:{rules,revision:assistantRulesRevision(rules),canWrite:access.isSystemAdmin||access.permissions.lines?.includes('assign')===true}});
}));
router.put('/assistant-detection-rules',requirePermission({lines:['assign']}),authorized(async(req,res)=>{
 const input=z.object({rules:assistantDetectionRulesSchema,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(req.body);
 const rules=await saveAssistantDetectionRules(crmDb,req.auth.activeOrganizationId,input.rules,input.expectedRevision);
 await recordAuditEvent({organizationId:req.auth.activeOrganizationId,userId:req.auth.userId,action:'calls.assistant_detection_rules.updated',resourceType:'WorkspaceCallPolicy',resourceId:req.auth.activeOrganizationId,metadata:{count:rules.length}});
 res.json({success:true,data:{rules,revision:assistantRulesRevision(rules),canWrite:true}});
}));
router.post('/assistant-detection-rules/test',requirePermission({lines:['read']}),authorized(async(req,res)=>{
 const input=z.object({text:z.string().trim().min(1).max(6000)}).strict().parse(req.body);
 const {matched,diagnostics}=evaluateAssistantDetection(input.text,await assistantDetectionRules(crmDb,req.auth.activeOrganizationId),true);
 res.json({success:true,data:{text:input.text,matched:!!matched,rule:matched?.rules[0]||null,rules:matched?.rules||[],evidence:matched?.evidence||null,diagnostics}});
}));
router.use((req,res,next)=>{const voicePlayback=req.method==='GET'&&/^\/voices\/[^/]+\/(?:opening(?:\/audio)?|cached-preview|current-preview)$/.test(req.path);const resource=(preparedDemoAccess(req.method,req.path)||voicePlayback||req.path.startsWith('/my-voices')||req.path.startsWith('/script-recordings'))?'agent':req.path.startsWith('/aliyun-engine')?'lines':req.path.startsWith('/recordings')?'callLogs':req.path.startsWith('/seats')?'seats':req.path.startsWith('/service-providers')||req.path.startsWith('/lines')||req.path.startsWith('/callback')||req.path.startsWith('/test-number-whitelist')||req.path==='/connection'||req.path==='/caller-numbers'||req.path==='/voice-operations'?'lines':req.path.startsWith('/models')||req.path.startsWith('/voices')||req.path.startsWith('/agents')?'agentConfiguration':'outboundCalls';return requirePermission({[resource]:['read']})(req,res,next);});
const scope=(req:{auth:{activeOrganizationId:string,userId:string}}):Scope=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
const send=(res:{json:(v:unknown)=>unknown},data:unknown)=>res.json({success:true,data});
router.use('/agents',authorized(async(req,_res,next)=>{if(preparedDemoAccess(req.method,'/agents'+req.path)){next();return;}const access=await memberAccess(crmDb,scope(req));if(!canTrain(access.permissions)&&!canPublish(access.permissions))throw new ForbiddenError('培训草稿由获授权的负责人查看。');next();}));
router.use(demoRouter);
router.get('/voice-policy',authorized(async(req,res)=>send(res,await voiceDeliverySettings(scope(req)))));
router.put('/voice-policy',authorized(async(req,res)=>send(res,await saveVoiceDelivery(scope(req),req.body))));
router.get('/voice-operations',authorized(async(req,res)=>send(res,await voiceOperationsCatalog(scope(req)))));
router.patch('/voice-operations',authorized(async(req,res)=>send(res,await saveVoiceOperations(scope(req),req.body))));
router.get('/test-number-whitelist',authorized(async(req,res)=>send(res,await testNumberWhitelistCatalog(scope(req)))));
router.post('/test-number-whitelist',authorized(async(req,res)=>send(res,await createTestNumberWhitelistItem(scope(req),req.body))));
router.patch('/test-number-whitelist/:id',authorized(async(req,res)=>send(res,await updateTestNumberWhitelistItem(scope(req),id.parse(req.params.id),req.body))));
router.delete('/test-number-whitelist/:id',authorized(async(req,res)=>send(res,await deleteTestNumberWhitelistItem(scope(req),id.parse(req.params.id),req.body))));
router.post('/script-recordings/:id/generate',requirePermission({agent:['read']}),authorized(async(req,res)=>send(res,await generateOpening(scope(req),id.parse(req.params.id),req.body))));
router.post('/script-recordings/:id/generate-answer',requirePermission({agent:['read']}),authorized(async(req,res)=>send(res,await generateAnswer(scope(req),id.parse(req.params.id),req.body))));
router.post('/script-recordings/:id',requirePermission({agent:['read']}),authorized(async(req,res)=>send(res,await uploadRecording(scope(req),id.parse(req.params.id),req.body))));
router.post('/script-recordings/:id/clone-voice',requirePermission({agent:['read']}),authorized(async(req,res)=>send(res,await cloneOpeningVoice(scope(req),id.parse(req.params.id),req.body))));
router.get('/script-recordings/:id/:assetId/audio',authorized(async(req,res)=>{res.type('audio/wav').send(await recordingAudio(scope(req),id.parse(req.params.id),id.parse(req.params.assetId)));}));
router.get('/my-voices/:id',authorized(async(req,res)=>send(res,await personalVoice.personalVoiceCatalog(scope(req),id.parse(req.params.id)))));
router.put('/my-voices/:id',authorized(async(req,res)=>send(res,await personalVoice.savePersonalVoice(scope(req),id.parse(req.params.id),req.body))));
router.post('/my-voices/:id/script-preview',authorized(async(req,res)=>send(res,await personalVoice.personalScriptPreview(scope(req),id.parse(req.params.id),req.body))));
router.post('/my-voices/:id/preview',authorized(async(req,res)=>send(res,await personalVoice.personalVoicePreview(scope(req),id.parse(req.params.id),req.body))));
router.get('/my-voices/:id/samples/:voiceId',authorized(async(req,res)=>{
 const url=await personalVoice.personalVoiceSample(scope(req),id.parse(req.params.id),id.parse(req.params.voiceId));
 const audio=await openCallbackRecording(url,[new URL(url).hostname],req.get('range'));
 res.status(audio.statusCode||200);res.setHeader('Content-Type',audio.headers['content-type']||'audio/mpeg');res.setHeader('Content-Disposition','inline');
 audio.on('error',()=>res.destroy());res.on('close',()=>audio.destroy());audio.pipe(res);
}));
router.get('/capacity',authorized(async(req,res)=>send(res,await capacity.capacityCatalog(scope(req),z.string().trim().min(1).max(100).default('mine').parse(req.query.ownerId)))));
router.get('/parallelism-policy',authorized(async(req,res)=>send(res,await outboundParallelismPolicy(scope(req)))));
router.put('/parallelism-policy',authorized(async(req,res)=>send(res,await saveOutboundParallelismPolicy(scope(req),req.body))));
router.put('/capacity',authorized(async(_req,res)=>{res.status(410).json({success:false,message:'公司、部门和员工调度额度已取消，请在线路管理中设置线路并发。'});}));
router.get('/aliyun-engine',authorized(async(req,res)=>send(res,await engine.engineCatalog(scope(req)))));
router.put('/aliyun-engine',authorized(async(req,res)=>send(res,await engine.saveEngineSettings(scope(req),req.body))));
router.get('/callback',authorized(async(req,res)=>send(res,await callback.callbackCatalog(scope(req)))));
router.put('/callback',authorized(async(req,res)=>send(res,await callback.saveCallbackSettings(scope(req),req.body))));
router.post('/callback/test',authorized(async(req,res)=>send(res,await callback.testCallbackConnection(scope(req)))));
router.post('/callback/employees/:userId/sync',authorized(async(req,res)=>send(res,await callback.syncCallbackEmployee(scope(req),String(req.params.userId)))));
router.get('/service-providers',authorized(async(req,res)=>send(res,await serviceProviders(scope(req)))));
router.post('/service-providers',authorized(async(req,res)=>send(res,await createServiceProvider(scope(req),req.body))));
router.get('/lines',authorized(async(req,res)=>send(res,await routing.regionalCatalog(scope(req)))));
router.post('/lines',authorized(async(req,res)=>send(res,await routing.saveRegionalLine(scope(req),null,req.body))));
router.put('/lines/default-scope',authorized(async(req,res)=>send(res,await routing.saveDefaultScope(scope(req),req.body))));
router.put('/lines/:id',authorized(async(req,res)=>send(res,await routing.saveRegionalLine(scope(req),id.parse(req.params.id),req.body))));
router.put('/lines/:id/assignment',authorized(async(req,res)=>send(res,await routing.assignRegionalLine(scope(req),managedLineId.parse(req.params.id),req.body))));
router.delete('/lines/:id',authorized(async(req,res)=>send(res,await routing.archiveRegionalLine(scope(req),managedLineId.parse(req.params.id)))));
router.post('/lines/:id/restore',authorized(async(req,res)=>send(res,await routing.restoreRegionalLine(scope(req),managedLineId.parse(req.params.id)))));
router.get('/voices',authorized(async(req,res)=>send(res,await voices.library(scope(req)))));
router.post('/voices/aliyun/sync',authorized(async(req,res)=>send(res,await syncEngineVoices(scope(req)))));
router.put('/voices/:id/enabled',authorized(async(req,res)=>send(res,await voices.setVoiceEnabled(scope(req),id.parse(req.params.id),req.body))));
router.post('/voices/:id/restore',authorized(async(req,res)=>send(res,await voices.restoreVoice(scope(req),id.parse(req.params.id)))));
router.put('/voices/:id/access',authorized(async(req,res)=>send(res,await voices.saveVoiceAccess(scope(req),id.parse(req.params.id),req.body))));
router.get('/voices/:id/remote-preview',authorized(async(req,res)=>{
 const url=await voices.remotePreviewSource(scope(req),id.parse(req.params.id));
 const audio=await openCallbackRecording(url,[new URL(url).hostname],req.get('range'));
 res.status(audio.statusCode||200);res.setHeader('Content-Type',audio.headers['content-type']||'audio/mpeg');res.setHeader('Content-Disposition','inline');
 audio.on('error',()=>res.destroy());res.on('close',()=>audio.destroy());audio.pipe(res);
}));
router.post('/voices/from-opening',authorized(async(req,res)=>send(res,await voiceOpenings.createOpeningVoice(scope(req),req.body))));
router.get('/voices/:id/cached-preview',authorized(async(req,res)=>{res.type('audio/wav').send(await cachedVoicePreview(scope(req),id.parse(req.params.id)));}));
router.get('/voices/:id/current-preview',authorized(async(req,res)=>send(res,{audio:(await voiceTuning.currentVoicePreview(scope(req),id.parse(req.params.id))).toString('base64')})));
router.get('/voices/:id/opening',authorized(async(req,res)=>send(res,await voiceOpenings.openingDetail(scope(req),id.parse(req.params.id)))));
router.put('/voices/:id/opening',authorized(async(req,res)=>send(res,await voiceOpenings.correctOpening(scope(req),id.parse(req.params.id),req.body))));
router.get('/voices/:id/opening/audio',authorized(async(req,res)=>{res.type('audio/wav').send(await voiceOpeningAudio(scope(req),id.parse(req.params.id)));}));
router.get('/voices/:id/training',authorized(async(req,res)=>send(res,await voiceTraining.trainingList(scope(req),id.parse(req.params.id)))));
router.post('/voices/:id/training',authorized(async(req,res)=>send(res,await voiceTraining.uploadTraining(scope(req),id.parse(req.params.id),req.body))));
router.post('/voices/:id/training/:sampleId/rollback',authorized(async(req,res)=>send(res,await voiceTraining.rollbackTraining(scope(req),id.parse(req.params.id),id.parse(req.params.sampleId),req.body))));
router.get('/voices/:id/training/:sampleId/audio',authorized(async(req,res)=>res.type('audio/wav').send(await voiceTraining.trainingAudio(scope(req),id.parse(req.params.id),id.parse(req.params.sampleId)))));
router.post('/voices/:id/render-audition',authorized(async(req,res)=>res.type('audio/wav').send(await renderVoiceAudition(scope(req),id.parse(req.params.id),req.body))));
router.get('/voices/:id/tuning',authorized(async(req,res)=>send(res,await voiceTuning.tuningDetail(scope(req),id.parse(req.params.id)))));
router.put('/voices/:id/tuning',authorized(async(req,res)=>send(res,await voiceTuning.saveVoiceTuning(scope(req),id.parse(req.params.id),req.body))));
router.get('/voices/:id/auditions',authorized(async(req,res)=>send(res,await voiceTuning.voiceAuditions(scope(req),id.parse(req.params.id)))));
router.post('/voices/:id/auditions',authorized(async(req,res)=>send(res,await voiceTuning.createVoiceAudition(scope(req),id.parse(req.params.id),req.body))));
router.get('/voices/:id/auditions/:auditionId/audio',authorized(async(req,res)=>{res.type('audio/wav').send(await voiceTuning.voiceAuditionAudio(scope(req),id.parse(req.params.id),id.parse(req.params.auditionId)));}));
router.post('/voices',authorized(async(req,res)=>send(res,await voices.createVoice(scope(req),req.body))));
router.post('/voices/:id/enroll',authorized(async(req,res)=>send(res,await voices.enrollVoice(scope(req),id.parse(req.params.id),req.body))));
router.delete('/voices/:id',authorized(async(req,res)=>send(res,await voices.archiveVoice(scope(req),id.parse(req.params.id)))));
router.get('/voices/:id/sample',authorized(async(req,res)=>{res.type('audio/wav').send(await voices.sourceSample(scope(req),id.parse(req.params.id)));}));
router.post('/voices/:id/preview',authorized(async(req,res)=>{res.type('audio/wav').send(await voices.previewVoice(scope(req),id.parse(req.params.id),req.body));}));
router.get('/models/credentials/:provider',authorized(async(req,res)=>{res.setHeader('Pragma','no-cache');send(res,await readCredential(scope(req),req.params.provider));}));
router.put('/models/credentials',authorized(async(req,res)=>send(res,await saveCredential(scope(req),req.body))));
router.get('/models',authorized(async(req,res)=>send(res,await models.catalog(scope(req)))));
router.get('/models/usage',authorized(async(req,res)=>send(res,await modelUsage.modelUsageCatalog(scope(req)))));
router.put('/models/usage/qwen/credentials',authorized(async(req,res)=>send(res,await modelUsage.saveBillingCredentials(scope(req),req.body))));
router.put('/models/usage/:provider',authorized(async(req,res)=>send(res,await modelUsage.saveModelAccount(scope(req),req.params.provider,req.body))));
router.post('/models/usage/:provider/refresh',authorized(async(req,res)=>send(res,await modelUsage.refreshModelAccounts(scope(req),req.params.provider))));
router.post('/models/:modelId/test',authorized(async(req,res)=>send(res,await models.testModel(scope(req),String(req.params.modelId)))));
router.put('/models',authorized(async(req,res)=>send(res,await models.saveModels(scope(req),req.body))));
router.get('/agents/:id/model',authorized(async(req,res)=>send(res,await models.selection(scope(req),id.parse(req.params.id)))));
router.put('/agents/:id/model',authorized(async(req,res)=>send(res,await models.saveSelection(scope(req),id.parse(req.params.id),req.body))));
router.get('/seats/candidates',authorized(async(req,res)=>send(res,await manual.seatCandidates(scope(req)))));
router.delete('/seats/:userId',authorized(async(req,res)=>send(res,await manual.removeSeat(scope(req),String(req.params.userId)))));
router.get('/seats',authorized(async(req,res)=>send(res,await manual.seats(scope(req)))));
router.put('/seats/:userId',authorized(async(req,res)=>send(res,await manual.saveSeat(scope(req),String(req.params.userId),req.body))));
router.post('/manual/preview',authorized(async(req,res)=>send(res,await manual.previewManual(scope(req),req.body))));
router.post('/manual/call',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await manual.dialManual(scope(req),req.body))));
router.post('/manual/:id/control',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await manual.control(scope(req),id.parse(req.params.id),req.body))));
router.post('/attempts/:id/reconcile',authorized(async(req,res)=>send(res,await manual.reconcile(scope(req),id.parse(req.params.id),req.body))));
router.get('/caller-numbers',authorized(async(req,res)=>send(res,await callerCatalog(scope(req)))));
router.get('/connection',authorized(async(req,res)=>send(res,await service.configuration(scope(req)))));
router.put('/connection',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>send(res,await service.saveLine(scope(req),req.body))));
router.get('/agents/:id/readiness',authorized(async(req,res)=>send(res,await service.agentReadiness(scope(req),id.parse(req.params.id)))));
router.get('/agents/:id/profile',authorized(async(req,res)=>send(res,await service.agentProfile(scope(req),id.parse(req.params.id)))));
router.put('/agents/:id/profile',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>send(res,await service.saveProfile(scope(req),id.parse(req.params.id),req.body))));
router.post('/agents/:id/voice-preview',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>send(res,await employeeVoicePreview(scope(req),id.parse(req.params.id),req.body))));
router.delete('/tasks/:id',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await service.deleteTask(scope(req),id.parse(req.params.id)))));
router.delete('/test-calls/:id',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await discardTestCallDraft(scope(req),id.parse(req.params.id)))));
router.post('/test-calls',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await startTestCall(scope(req),req.body))));
router.get('/test-calls/:id',authorized(async(req,res)=>send(res,await testCallStatus(scope(req),id.parse(req.params.id)))));
router.get('/tasks',authorized(async(req,res)=>{
  if(z.enum(['0','1']).default('0').parse(req.query.control)==='1')return send(res,await taskControlStatus(scope(req)));
  const owner=z.string().trim().min(1).max(100).default('mine').parse(req.query.ownerId),summary=z.enum(['0','1']).default('0').parse(req.query.summary)==='1';
  if(z.enum(['0','1']).default('0').parse(req.query.paged)==='1')return send(res,await service.taskPage(scope(req),owner,summary,z.enum(['AI','MANUAL']).optional().parse(req.query.kind),taskPageSchema.parse(req.query)));
  return send(res,await service.tasks(scope(req),owner,summary,z.literal('MANUAL').optional().parse(req.query.kind)));
}));
router.post('/tasks/pause-all',authorized(async(req,res)=>send(res,await pauseAllTasks(scope(req),req.body))));
router.post('/tasks/resume-all',authorized(async(req,res)=>send(res,await resumeAllTasks(scope(req),req.body))));
router.get('/tasks/:id',authorized(async(req,res)=>send(res,await service.taskDetails(scope(req),id.parse(req.params.id)))));
router.post('/tasks/:id/continue',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await service.continueExpiredTask(scope(req),id.parse(req.params.id),req.body))));
router.post('/tasks/:id/redial',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await service.redialTask(scope(req),id.parse(req.params.id),req.body))));
router.patch('/tasks/:id/retry',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await service.updateTaskRetry(scope(req),id.parse(req.params.id),req.body))));
router.patch('/tasks/:id/parallelism',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await service.updateTaskParallelism(scope(req),id.parse(req.params.id),req.body))));
router.post('/tasks',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>send(res,await service.createTask(scope(req),req.body))));
router.post('/tasks/:id/preview',authorized(async(req,res)=>send(res,await service.preview(scope(req),id.parse(req.params.id)))));
router.post('/tasks/:id/:action',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>{
 const input=z.object({confirmation:z.string().uuid().optional(),lineId:z.union([z.string().uuid(),z.literal('haokehu-default')]).optional()}).strict().parse(req.body||{});
 send(res,await service.taskAction(scope(req),id.parse(req.params.id),z.enum(['start','pause']).parse(req.params.action),input.confirmation,{lineId:input.lineId}));
}));
router.get('/recordings/:id',authorized(async(req,res)=>{
 const callId=id.parse(req.params.id),s=scope(req);
 const access=await memberAccess(crmDb,s);
 const recording=(await crmDb.query(`SELECT c."endTime",c."metadata"->>'recordingExpiredAt' AS "recordingExpiredAt" FROM "CallLog" c WHERE c."organizationId"=$1 AND c."callId"=$2 AND c."deleted"=false AND ($3 OR ${callVisibleSql("c","$1","$4")})`,[s.workspaceId,callId,access.canViewWorkspaceData,s.userId]))[0];
 if(!recording)throw new ForbiddenError('录音不存在或未授权。');
 if(recording.recordingExpiredAt||(recording.endTime&&new Date(recording.endTime).getTime()<Date.now()-72*60*60*1000))throw new BadRequestError('录音已超过3天保留期限，无法播放。');
 const engineRecord=(await crmDb.query(`SELECT e."recordingUrl" FROM "AliyunEngineCall" e JOIN "CallLog" l ON l."organizationId"=e."workspaceId" AND l."callId"=e."attemptId" WHERE e."workspaceId"=$1 AND e."attemptId"=$2 AND l."deleted"=false AND l."metadata"->>'provider'='ALIYUN_ENGINE' AND ($3 OR ${callVisibleSql("l","$1","$4")})`,[s.workspaceId,callId,access.canViewWorkspaceData,s.userId]))[0];
 if(engineRecord){const u=new URL(engineRecord.recordingUrl);const audio=await openCallbackRecording(u.toString(),[u.hostname],req.get('range'));res.status(audio.statusCode||200);res.setHeader('Content-Type',audio.headers['content-type']||'audio/mpeg');res.setHeader('Content-Disposition','inline');res.setHeader('Accept-Ranges','bytes');for(const name of ['content-length','content-range'])if(audio.headers[name])res.setHeader(name,audio.headers[name]!);audio.on('error',()=>res.destroy());res.on('close',()=>audio.destroy());audio.pipe(res);return;}
 const official=(await crmDb.query(`SELECT c."recordingUrl",c."recordingState" FROM "CallbackCall" c JOIN "CallLog" l ON l."organizationId"=c."workspaceId" AND l."callId"=c."attemptId" WHERE c."workspaceId"=$1 AND c."attemptId"=$2 AND l."deleted"=false AND l."metadata"->>'provider'='HAOKEHU_CALLBACK' AND ($3 OR ${callVisibleSql("l","$1","$4")})`,[s.workspaceId,callId,access.canViewWorkspaceData,s.userId]))[0];
 if(official){
  if(official.recordingState!=='READY')throw new BadRequestError('录音仍在生成，请稍后再听。');
  const connection=await callback.callbackConnection(s.workspaceId);
  const audio=await openCallbackRecording(official.recordingUrl,recordingHosts(connection||{}),req.get('range'));
  res.status(audio.statusCode||200);res.setHeader('Content-Type',audio.headers['content-type']||'audio/mpeg');res.setHeader('Content-Disposition','inline');res.setHeader('Accept-Ranges','bytes');
  for(const name of ['content-length','content-range'])if(audio.headers[name])res.setHeader(name,audio.headers[name]!);
  audio.on('error',()=>res.destroy());res.on('close',()=>audio.destroy());audio.pipe(res);return;
 }
 const rows=await crmDb.query(`SELECT c."callId" FROM "CallLog" c WHERE c."organizationId"=$1 AND c."callId"=$2 AND c."deleted"=false AND c."metadata"->>'provider'='HAOKEHU_SIP' AND c."metadata"->>'recordingFile'=$4 AND ($3 OR ${callVisibleSql("c","$1","$5")})`,[s.workspaceId,callId,access.canViewWorkspaceData,callId+'.wav',s.userId]);
 if(!rows.length)throw new ForbiddenError('录音不存在或未授权。');
 const response=await service.bridgeRequest('/recordings/'+callId,undefined,req.get('range'));
 if(!response.body)throw new BadRequestError('录音暂不可用。');
 res.status(response.status).type('audio/wav');res.setHeader('Content-Disposition','inline');
 for(const name of ['accept-ranges','content-length','content-range','last-modified']){const value=response.headers.get(name);if(value)res.setHeader(name,value);}
 const audio=Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
 audio.on('error',()=>res.destroy());res.on('close',()=>audio.destroy());audio.pipe(res);
}));
router.use((error:unknown,req:import('express').Request,_res:unknown,next:(e:unknown)=>void)=>next(error instanceof z.ZodError?(/^\/tasks(?:\/|$)/.test(req.path)?taskValidationError(error):new BadRequestError(error.issues.map(i=>i.message).join('；'))):error));
export default router;
