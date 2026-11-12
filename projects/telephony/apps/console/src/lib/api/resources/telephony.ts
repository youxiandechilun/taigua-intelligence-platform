/*
 * 中文导读：线路与语音外呼的前端接口封装，将页面调用连接到后端资源。
 */
export const CALL_VOICE_MODEL='qwen3.8-omni-flash-realtime' as const;
import { useQuery } from '@tanstack/react-query';
import { apiClient, unwrap } from '../client';
import { useAliyunIdentity } from '@/src/hooks/queries/aliyun';
import type { DialPolicy, Recipient } from './aliyun';
export type CarrierPolicy={start:string;end:string;maxCallsPerNumberPerDay:number;blockedProvinces:string[]};
export type Line = {serviceProvider?:string;callerMode?:'custom'|'provider';carrierPolicy?:CarrierPolicy|null;name:string;trunkKey?:string;serverIp?:string;port?:number;transport?:'udp'|'tcp';callerNumber:string;prefix?:string;employeePrefix?:string;codecs?:string[];concurrency:number;callsPerSecond?:number;ringTimeoutSeconds?:number;costPerMinute?:number|null;liveEnabled:boolean;whitelistConfirmed?:boolean;dialPolicy:DialPolicy};
export type LineHealth={state:'healthy'|'degraded'|'offline';consecutiveFailures:number;lastSuccessAt:string|null;lastFailureAt:string|null;lastFailureReason:string;cooldownUntil:string|null;checkedAt:string|null};
export type Connection=Line & {revision?:string;removed:boolean;canConfigure:boolean;canManage:boolean;ready:boolean;serviceReady:boolean;manualReady:boolean;manualServiceReady:boolean;manualProvider?:string;manualControls?:boolean;dialWindowOpen:boolean;dialWindowMessage:string;engineConnected:boolean;executionEnabled:boolean;manualMissing:string[];aiMissing:string[];missing:string[];defaultVoice:string;model:string;lineHealth?:LineHealth|null};
export type TaskRetryPolicy={retries:number;retryIntervalMinutes:number};
export type TaskOutcome='ANSWERED'|'UNANSWERED'|'FAILED'|'ASSISTANT'|'PENDING'|'ACTIVE'|'UNCERTAIN'|'CANCELLED';
export type TaskResultStats={dialed:number;answered:number;unanswered:number;assistant:number;pending:number};
export const taskOutcomeNames:Record<TaskOutcome,string>={ANSWERED:'已接听',UNANSWERED:'未接听',FAILED:'未打通',ASSISTANT:'语音助手',PENDING:'待拨打',ACTIVE:'正在拨打',UNCERTAIN:'结果待回传',CANCELLED:'已取消'};
export type TaskRecipientResult={recipientIndex:number;attemptId:string|null;outcome:TaskOutcome;redialEligible:boolean;redialBlockedReason?:string};
export type TaskDispatch={state:string;label:string;message:string;nextDialAt:string|null};
export type CarrierBatchSummary={totalCount:number;acceptedCount:number;skippedCount:number;skipReasons:{reason:string;count:number}[]};
export type TaskCreationResult={id:string;status:string}&Partial<CarrierBatchSummary>;
export type TaskActionResult={status?:string;note?:string}&Partial<CarrierBatchSummary>;
type TaskRequestOptions={signal?:AbortSignal;timeout?:number};
export type TaskPageOptions={page:number;pageSize:number;search?:string;status?:string;outcome?:TaskOutcome|'ALL';kind?:'AI'|'MANUAL';summary?:boolean};
export type SipTaskPage={items:SipTask[];total:number;page:number;pageSize:number;outcomeTotals?:Record<TaskOutcome,number>;resultStatsTotals?:TaskResultStats};
export type TaskBatchControl={canControl:boolean;runningCount:number;activeBatch:{id:string;pausedCount:number;pausedAt:string}|null};
export type TaskBatchResult={batchId?:string;pausedCount?:number;resumedCount?:number;remainingCount?:number;alreadyPausedCount?:number;skippedCount?:number;failed?:{id?:string;name?:string;reason:string}[];failures?:{id?:string;name?:string;reason:string}[];skipped?:{id?:string;name?:string;reason:string}[]};
export type SipTask={summary?:boolean;recipientCount?:number;hasQueuedAttempts?:boolean;continuationEligibleCount?:number;redialEligibleCount?:number;carrierSummary?:CarrierBatchSummary|null;dispatch?:TaskDispatch|null;callerMode?:string;callerLabel?:string;outcomes?:Record<TaskOutcome,number>;resultStats?:TaskResultStats;recipientResults?:TaskRecipientResult[];redialSupported?:boolean;redialSourceTaskId?:string|null;retrySupported?:boolean;retryPolicy?:TaskRetryPolicy;serviceProvider?:string;parallelism?:number;effectiveParallelism?:number;createdByName?:string;localPreview?:boolean;localRemoved?:boolean;lineId?:string;lineName?:string;province?:string;lineRoutes?:{lineId:string;lineName:string;province:string;callerNumber:string;callerMode?:string;callerLabel?:string;recipients:number}[];startTime?:string;endTime?:string;id:string;createdBy:string;name:string;kind:'AI'|'MANUAL';provider?:string;releaseVersion?:number|null;voiceName?:string;voiceVolume?:number|null;canOperate?:boolean;manualControls?:boolean;agentName:string;status:string;recipients:Recipient[];callerNumber:string;createdAt:string;error:string;attempts:{id:string;recipientIndex:number;attemptNumber:number;nextAttemptAt?:string;startedAt?:string|null;status:string;result:{diagnostics?:CallDiagnostics|null;retryPolicyCancelled?:boolean;reason?:string;durationSeconds?:number;recordingState?:string}}[]};
export type Model={id:string;name:string;vendor:string;kind:'text'|'realtime';enabled:boolean;configured:boolean;voices?:{id:string;name:string}[];connected:boolean;checkedAt:string|null;message:string};
export type ModelCatalog={revision:string;canConfigure:boolean;canManage:boolean;summaryModel:string;credentials:{id:string;name:string;configured:boolean;canSave:boolean}[];models:Model[]};
export type ModelAccountSettings={balanceSource:'auto'|'manual';manualBalance:number|null;currency:'CNY'|'USD'|'JPY';lowBalanceThreshold:number|null;monthlyTokenLimit:number|null;tokenWarningPercent:number;alertsEnabled:boolean};
export type ModelPlatformUsage={id:string;name:string;configured:boolean;automaticBalance:boolean;billingUrl:string;balanceCredentialsConfigured:boolean;settings:ModelAccountSettings;balances:{currency:string;available:number;cash?:number}[];balanceCheckedAt:string|null;balanceStale:boolean;balanceError:string;balanceAttemptedAt:string|null;balanceScope:string;month:string;todayTokens:number;totalTokens:number;inputTokens:number;outputTokens:number;inputAudioTokens:number;outputAudioTokens:number;cachedTokens:number;requests:number;missingUsage:number;remainingBudget:number|null;models:{modelId:string;purpose:string;totalTokens:number|null;inputTokens:number|null;outputTokens:number|null;requests:number;missingUsage:number}[]};
export type ModelUsageCatalog={platforms:ModelPlatformUsage[];trackingSince:string|null;updatedAt:string};
export type ModelUsageAlert={id:string;provider:string;kind:'BALANCE'|'TOKENS'|'BALANCE_SYNC';title:string;message:string;triggeredAt:string};
export type Seat={userId:string;name:string;accountName:string;department:string;phone:string;available:boolean};
export type AudioSettings={volume:number;enhanceQuietSpeech:boolean;noiseReduction:"off"|"mild";responseSpeed:"fast"|"balanced"|"patient";sensitivity:"normal"|"sensitive";noInputSeconds:number;backgroundScene?:"off"|"office"|"opening";backgroundVolume?:number};
export const defaultAudioSettings:AudioSettings={volume:100,enhanceQuietSpeech:true,noiseReduction:"mild",responseSpeed:"balanced",sensitivity:"sensitive",noInputSeconds:10,backgroundScene:"off",backgroundVolume:6};
export type VoiceProfile={audio:AudioSettings;voice:string;language:string;voiceId:string;realtimeModel:string};
export type AgentVoicePreview={status:'GENERATING'|'READY'|'NEEDS_REVIEW';requestId:string;model:string;voice:string;cached:boolean;error:string;audio:string|null};
export type AgentVoiceReadiness={ready:boolean;missing:string[];model:string;defaultModel:string};
export type VoiceOpeningSummary={id:string;status:string;text:string;durationSeconds:number;error:string;ready:boolean};
export type VoiceOpeningDetail=VoiceOpeningSummary&{fileName:string;sourceHash:string;sha256:string;analysis:{durationSeconds:number;rmsDb:number;peakDb:number;pauseCount:number;medianPauseMs:number;charactersPerSecond?:number};updatedAt:string;revision?:string};
export type VoiceAudition={id:string;requestId:string;status:string;text:string;error:string;createdAt?:string;cached?:boolean;audio?:string|null};
export type Voice={accessRevision?:string;opening?:VoiceOpeningSummary|null;id:string;name:string;provider:'HAOKEHU_SIP'|'ALIYUN_ENGINE'|'BUILTIN';enabled?:boolean;voice?:string;deletedAt?:string|null;gender:'neutral'|'female'|'male';employeeVisible:boolean;assignedUserIds:string[];targetModel:string;status:string;previewStatus:string;error:string;hasPreview:boolean;createdAt:string};
export type VoiceLibrary={canManage:boolean;canManageAccess:boolean;models:string[];voices:Voice[];removedVoices?:Voice[];voiceManagementVersion?:number};
export type RegionalLine={assignmentRevision?:string;scopeRevision?:string;revision?:string;serviceProvider?:string;id:string;name:string;provinces:string[];note:string;enabled:boolean;liveEnabled:boolean;health?:LineHealth;assignedUserIds?:string[];publicLine?:boolean;canAssign?:boolean;line?:Line;localPreview?:boolean;quotaPending?:boolean;defaultLine?:boolean};
export type RegionalCatalog={canConfigure:boolean;canManage:boolean;provinces:string[];lines:RegionalLine[];removedLines?:RegionalLine[]};
export type RegionalInput={expectedRevision?:string;line:Line;provinces:string[];note:string;enabled:boolean;assignedUserIds:string[]};
export const voiceModelNames:Record<string,string>={'stepaudio-2.5-realtime':'阶跃星辰实时语音 2.5','step-1o-audio':'阶跃星辰实时语音 1o','qwen-audio-3.1-realtime-plus':'通义千问实时语音 3.1 Plus','qwen3.8-omni-flash-realtime':'通义全模态 3.8','qwen3.5-omni-plus-realtime':'通义全模态 3.5 增强版','qwen3.5-omni-flash-realtime':'通义全模态 3.5 快速版'};
const options=(org:string)=>({headers:{'x-workspace-id':org}});
const base='/telephony';
export type CallbackConfig={configured:boolean;canConfigure:boolean;canStore:boolean;enabled:boolean;connected:boolean;credentialConfigured?:boolean;appKey?:string;apiOrigin?:string;callbackUrl?:string;updatedAt:string|null;checkedAt:string|null;lastWebhookAt:string|null;webhookConfirmed:boolean;maxConcurrent:number;callsPerSecond:number;recordingHosts:string[];employees:{userId:string;name:string;department:string;phone:string;available:boolean;ready:boolean}[]};
export type CallCapacity={partial?:boolean;canConfigure:boolean;policy:{companyConcurrent:number;departmentConcurrent:number;employeeConcurrent:number};queued:number;active:number;needsReview:number};
export type EngineSettings={enabled:boolean;regionId:string;applicationCode:string;callerNumber:string;resourcesConfirmed:boolean;concurrency:number;callsPerSecond:number;ttsVoiceCode:string;dialPolicy:DialPolicy};
export type EngineConfig={canConfigure:boolean;ready:boolean;missing:string[];name:string;settings?:EngineSettings;gatewayConfigured?:boolean;receiptConfigured?:boolean};
export type CallerRow={serviceProvider?:string;id:string;provider:'HAOKEHU_SIP'|'ALIYUN_ENGINE'|'ALIYUN_LEGACY';name:string;identifier:string;identifierLabel:string;displayNumber:string|null;scope:string;ready:boolean;enabled:boolean;usages:{label:string;ready:boolean}[];missing:string[];link:string;localPreview?:boolean};
export type CallerCatalog={canConfigure:boolean;rows:CallerRow[];updatedAt:string};
export type TestCallInput={requestId:string;agentId:string;phoneNumber:string;lineId?:string;province?:string;requestedAt:string;confirmation:'拨打测试电话'};
import type { CallDiagnostics } from '../call-diagnostics';
export type { CallDiagnostics } from '../call-diagnostics';
export type TestCallStatus={diagnostics?:CallDiagnostics|null;id:string;agentId:string;status:string;taskStatus:string;attemptId:string|null;error:string;durationSeconds:number;agentName:string;voiceName:string;maxDurationSeconds:number};
export const telephonyApi={
 serviceProviders:(org:string)=>unwrap<{canConfigure:boolean;providers:{id:string;name:string}[]}>(apiClient.get(base+'/service-providers',options(org))),
 createServiceProvider:(org:string,name:string)=>unwrap<{id:string;name:string}>(apiClient.post(base+'/service-providers',{name},options(org))),
 discardTestCall:(org:string,id:string)=>unwrap(apiClient.delete(base+'/test-calls/'+id,options(org))),
 testCall:(org:string,input:TestCallInput)=>unwrap<TestCallStatus>(apiClient.post(base+'/test-calls',input,options(org))),
 testCallStatus:(org:string,id:string)=>unwrap<TestCallStatus>(apiClient.get(base+'/test-calls/'+id,options(org))),
 callers:(org:string)=>unwrap<CallerCatalog>(apiClient.get(base+'/caller-numbers',options(org))),
 capacity:(org:string,ownerId='mine')=>unwrap<CallCapacity>(apiClient.get(base+'/capacity',{...options(org),params:{ownerId}})),
 engine:(org:string)=>unwrap<EngineConfig>(apiClient.get(base+'/aliyun-engine',options(org))),
 saveEngine:(org:string,settings:EngineSettings)=>unwrap<EngineConfig>(apiClient.put(base+'/aliyun-engine',settings,options(org))),
 callback:(org:string)=>unwrap<CallbackConfig>(apiClient.get(base+'/callback',options(org))),
 saveCallback:(org:string,data:unknown)=>unwrap<CallbackConfig>(apiClient.put(base+'/callback',data,options(org))),
 testCallback:(org:string)=>unwrap<{connected:boolean;message:string}>(apiClient.post(base+'/callback/test',{},options(org))),
 syncCallbackEmployee:(org:string,id:string)=>unwrap<{synced:boolean;message:string}>(apiClient.post(base+'/callback/employees/'+encodeURIComponent(id)+'/sync',{},options(org))),
 lines:(org:string)=>unwrap<RegionalCatalog>(apiClient.get(base+'/lines',options(org))),
 saveLine:(org:string,id:string|null,data:RegionalInput)=>unwrap<{id:string}>(id?apiClient.put(base+'/lines/'+id,data,options(org)):apiClient.post(base+'/lines',data,options(org))),
 assignLine:(org:string,id:string,assignedUserIds:string[],expectedRevision?:string)=>unwrap(apiClient.put(base+'/lines/'+id+'/assignment',{assignedUserIds,expectedRevision},options(org))),
 removeLine:(org:string,id:string)=>unwrap(apiClient.delete(base+'/lines/'+id,options(org))),
 saveDefaultLineScope:(org:string,provinces:string[],expectedRevision?:string)=>unwrap<{saved:boolean;revision:string}>(apiClient.put(base+'/lines/default-scope',{provinces,expectedRevision},options(org))),
 restoreLine:(org:string,id:string)=>unwrap(apiClient.post(base+'/lines/'+id+'/restore',{},options(org))),
 openingVoice:(org:string,data:{name:string;fileName:string;gender?:'neutral'|'female'|'male';audio:string;consented:true})=>unwrap<{id:string;status:string;cached:boolean}>(apiClient.post(base+'/voices/from-opening',data,{...options(org),timeout:30000})),
 voiceOpening:(org:string,id:string)=>unwrap<VoiceOpeningDetail>(apiClient.get(base+'/voices/'+id+'/opening',options(org))),
 saveVoiceOpening:(org:string,id:string,text:string,expectedUpdatedAt:string,expectedRevision?:string)=>unwrap<VoiceOpeningDetail>(apiClient.put(base+'/voices/'+id+'/opening',{text,expectedUpdatedAt,expectedRevision},options(org))),
 cachedVoicePreview:async(org:string,id:string)=>(await apiClient.get<Blob>(base+'/voices/'+id+'/cached-preview',{...options(org),responseType:'blob'})).data,
 currentVoicePreview:async(org:string,id:string)=>{const result=await unwrap<{audio:string}>(apiClient.get(base+'/voices/'+id+'/current-preview',options(org)));return new Blob([Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0))],{type:'audio/wav'});},
 openingAudio:async(org:string,id:string)=>(await apiClient.get<Blob>(base+'/voices/'+id+'/opening/audio',{...options(org),responseType:'blob'})).data,
 voiceAuditions:(org:string,id:string)=>unwrap<VoiceAudition[]>(apiClient.get(base+'/voices/'+id+'/auditions',options(org))),
 generateVoiceAudition:(org:string,id:string,text:string,requestId:string,settings?:VoiceTuningSettings,retryOf?:string)=>unwrap<VoiceAudition>(apiClient.post(base+'/voices/'+id+'/auditions',{text,requestId,confirmed:true,...(settings?{settings}:{}),...(retryOf?{retryOf,retryConfirmed:true}:{})},{...options(org),timeout:65000})),
 voiceAuditionAudio:async(org:string,id:string,auditionId:string)=>(await apiClient.get<Blob>(base+'/voices/'+id+'/auditions/'+auditionId+'/audio',{...options(org),responseType:'blob'})).data,
 voices:(org:string)=>unwrap<VoiceLibrary>(apiClient.get(base+'/voices',options(org))),
 createVoice:(org:string,data:{name:string;gender?:'neutral'|'female'|'male';targetModel:string;audio:string;consented:true})=>unwrap<{id:string}>(apiClient.post(base+'/voices',data,options(org))),
 syncEngineVoices:(org:string)=>unwrap<{count:number}>(apiClient.post(base+'/voices/aliyun/sync',{},options(org))),
 saveVoiceAccess:(org:string,id:string,data:{employeeVisible:boolean;assignedUserIds:string[];gender:'neutral'|'female'|'male';expectedRevision?:string})=>unwrap<{saved:boolean}>(apiClient.put(base+'/voices/'+id+'/access',data,options(org))),
 remoteVoicePreview:async(org:string,id:string)=>(await apiClient.get<Blob>(base+'/voices/'+id+'/remote-preview',{...options(org),responseType:'blob'})).data,
 enrollVoice:(org:string,id:string)=>unwrap<{status:string;error:string}>(apiClient.post(base+'/voices/'+id+'/enroll',{confirmation:id,consented:true},options(org))),
 setVoiceEnabled:(org:string,id:string,enabled:boolean)=>unwrap(apiClient.put(base+'/voices/'+id+'/enabled',{enabled},options(org))),
 restoreVoice:(org:string,id:string)=>unwrap(apiClient.post(base+'/voices/'+id+'/restore',{},options(org))),
 removeVoice:(org:string,id:string)=>unwrap(apiClient.delete(base+'/voices/'+id,options(org))),
 voiceSample:async(org:string,id:string)=>(await apiClient.get<Blob>(base+'/voices/'+id+'/sample',{...options(org),responseType:'blob'})).data,
 voicePreview:async(org:string,id:string)=>(await apiClient.post<Blob>(base+'/voices/'+id+'/preview',{confirmation:id},{...options(org),responseType:'blob'})).data,

 connection:(org:string)=>unwrap<Connection>(apiClient.get(base+'/connection',options(org))),
 save:(org:string,data:Line,expectedRevision?:string)=>unwrap<Connection>(apiClient.put(base+'/connection',{...data,expectedRevision},options(org))),
 redial:(org:string,id:string,data:{requestId:string;attemptIds:string[];confirmed:true;lineId?:string})=>unwrap<{id:string;status:string;count:number;duplicate:boolean;startError:string;lineId?:string|null}&Partial<CarrierBatchSummary>>(apiClient.post(base+'/tasks/'+id+'/redial',data,{...options(org),timeout:90000})),
 retry:(org:string,id:string,data:{policy:TaskRetryPolicy;expectedPolicy:TaskRetryPolicy;includePrevious:boolean})=>unwrap<{policy:TaskRetryPolicy;scheduled:number;cancelled:number;requiresContinue:boolean}>(apiClient.patch(base+'/tasks/'+id+'/retry',data,options(org))),
 parallelism:(org:string,id:string,parallelism:number,expectedParallelism:number)=>unwrap(apiClient.patch(base+'/tasks/'+id+'/parallelism',{parallelism,expectedParallelism},options(org))),
 taskControl:(org:string)=>unwrap<TaskBatchControl>(apiClient.get(base+'/tasks',{...options(org),params:{control:1}})),
 pauseAll:(org:string,requestId:string)=>unwrap<TaskBatchResult>(apiClient.post(base+'/tasks/pause-all',{requestId,confirmed:true},{...options(org),timeout:90000})),
 resumeAll:(org:string,batchId:string)=>unwrap<TaskBatchResult>(apiClient.post(base+'/tasks/resume-all',{batchId,confirmed:true},{...options(org),timeout:90000})),
 tasksPage:(org:string,ownerId:string,page:TaskPageOptions,request:TaskRequestOptions={})=>unwrap<SipTaskPage>(apiClient.get(base+'/tasks',{...options(org),timeout:30000,...request,params:{ownerId,paged:1,...page,summary:page.summary?1:0}})),
 tasks:(org:string,ownerId='mine',request:TaskRequestOptions&{summary?:boolean;kind?:'MANUAL'}={})=>{const {summary,kind,...requestOptions}=request;return unwrap<SipTask[]>(apiClient.get(base+'/tasks',{...options(org),timeout:15000,...requestOptions,params:{ownerId,...(summary?{summary:1}:{}),...(kind?{kind}:{})}}));},
 task:(org:string,id:string,request:TaskRequestOptions={})=>unwrap<SipTask>(apiClient.get(base+'/tasks/'+encodeURIComponent(id),{...options(org),timeout:15000,...request})),
 create:(org:string,data:{requestId?:string;retryPolicy?:TaskRetryPolicy;parallelism?:number;provider?:'HAOKEHU_SIP'|'ALIYUN_ENGINE';lineId?:string;province?:string;name:string;agentId:string;recipients:Recipient[];startTime:string;endTime:string},request:TaskRequestOptions={})=>unwrap<TaskCreationResult>(apiClient.post(base+'/tasks',data,{...options(org),timeout:30000,...request})),
 action:(org:string,id:string,action:string,data:unknown={},request:TaskRequestOptions={})=>unwrap<TaskActionResult>(apiClient.post(base+'/tasks/'+id+'/'+action,data,{...options(org),timeout:30000,...request})),
 remove:(org:string,id:string)=>unwrap(apiClient.delete(base+'/tasks/'+id,options(org))),
 preview:(org:string,id:string)=>unwrap<{opening:string;stages:string[];simulated:boolean}>(apiClient.post(base+'/tasks/'+id+'/preview',{},options(org))),
 profile:(org:string,id:string)=>unwrap<{profile:VoiceProfile}>(apiClient.get(base+'/agents/'+id+'/profile',options(org))),
 saveProfile:(org:string,id:string,data:unknown)=>unwrap(apiClient.put(base+'/agents/'+id+'/profile',data,options(org))),
 previewEmployeeVoice:(org:string,id:string,data:{profile:VoiceProfile;text:string;requestId:string;retryOf?:string;confirmed:true})=>unwrap<AgentVoicePreview>(apiClient.post(base+'/agents/'+id+'/voice-preview',data,{...options(org),timeout:65000})),
 readCredential:(org:string,provider:string)=>unwrap<{provider:string;apiKey:string}>(apiClient.get(base+'/models/credentials/'+encodeURIComponent(provider),options(org))),
 testModel:(org:string,modelId:string)=>unwrap<{connected:boolean;message:string}>(apiClient.post(base+'/models/'+encodeURIComponent(modelId)+'/test',{},options(org))),
 saveCredential:(org:string,data:{provider:string;apiKey:string})=>unwrap<{saved:boolean}>(apiClient.put(base+'/models/credentials',data,options(org))),
 readiness:(org:string,id:string)=>unwrap<AgentVoiceReadiness>(apiClient.get(base+'/agents/'+id+'/readiness',options(org))),
 models:(org:string)=>unwrap<ModelCatalog>(apiClient.get(base+'/models',options(org))),
 modelUsage:(org:string)=>unwrap<ModelUsageCatalog>(apiClient.get(base+'/models/usage',options(org))),
 saveBillingCredentials:(org:string,data:{accessKeyId:string;accessKeySecret:string;securityToken:string})=>unwrap<ModelUsageCatalog>(apiClient.put(base+'/models/usage/qwen/credentials',data,options(org))),
 saveModelAccount:(org:string,provider:string,settings:ModelAccountSettings)=>unwrap<ModelUsageCatalog>(apiClient.put(base+'/models/usage/'+encodeURIComponent(provider),settings,options(org))),
 refreshModelBalance:(org:string,provider:string)=>unwrap<ModelUsageCatalog>(apiClient.post(base+'/models/usage/'+encodeURIComponent(provider)+'/refresh',{},options(org))),
 modelAlerts:(org:string)=>unwrap<{alerts:ModelUsageAlert[];updatedAt:string}>(apiClient.get('/dashboard/model-alerts',options(org))),
 saveModels:(org:string,data:{enabled:string[];summaryModel:string;expectedRevision:string})=>unwrap<ModelCatalog>(apiClient.put(base+'/models',data,options(org))),
 selection:(org:string,id:string)=>unwrap<{modelId:string}>(apiClient.get(base+'/agents/'+id+'/model',options(org))),
 selectModel:(org:string,id:string,modelId:string)=>unwrap(apiClient.put(base+'/agents/'+id+'/model',{modelId},options(org))),
 seatCandidates:(org:string)=>unwrap<{userId:string;name:string}[]>(apiClient.get(base+'/seats/candidates',options(org))),
 removeSeat:(org:string,id:string)=>unwrap(apiClient.delete(base+'/seats/'+encodeURIComponent(id),options(org))),
 seats:(org:string)=>unwrap<Seat[]>(apiClient.get(base+'/seats',options(org))),
 saveSeat:(org:string,id:string,data:{phone?:string;available:boolean;displayName?:string;department?:string})=>unwrap<Seat[]>(apiClient.put(base+'/seats/'+encodeURIComponent(id),data,options(org))),
 manualPreview:(org:string,data:unknown)=>unwrap<{steps:string[];employeePhone:string;missing:string[];ready:boolean;lineName:string;province:string}>(apiClient.post(base+'/manual/preview',data,options(org))),
 dial:(org:string,data:unknown)=>unwrap<{id:string;duplicate:boolean;status:string;reason:string}>(apiClient.post(base+'/manual/call',data,options(org))),
 control:(org:string,id:string,action:string,digit?:string)=>unwrap(apiClient.post(base+'/manual/'+id+'/control',{action,digit},options(org))),
 reconcile:(org:string,id:string,data:unknown)=>unwrap<{active:boolean;closed?:boolean;canArchive?:boolean;resolved?:boolean;message?:string}>(apiClient.post(base+'/attempts/'+id+'/reconcile',data,options(org))),
};
export function useTelephony({refreshStatus=false}:{refreshStatus?:boolean}={}){const {org,user}=useAliyunIdentity();return useQuery({queryKey:['telephony',user,org,'connection'],queryFn:()=>telephonyApi.connection(org),enabled:!!org,retry:false,staleTime:15000,refetchInterval:refreshStatus?15000:false,refetchIntervalInBackground:false});}
export const phoneStatus:Record<string,string>={DRAFT:'草稿',RUNNING:'执行中',PAUSED:'已暂停',COMPLETED:'已完成',NEEDS_REVIEW:'待核对',QUEUED:'待拨打',DISPATCHING:'连接中',DIALING:'呼叫中',CONNECTED:'通话中',NOT_ANSWERED:'未接通',FAILED:'失败',CANCELLED:'已归档'};
export { callReason, callReasonText } from '../call-diagnostics';

export function useManualTasks(){const {org,user}=useAliyunIdentity();
 return useQuery({queryKey:['telephony',user,org,'tasks'],queryFn:()=>telephonyApi.tasks(org,'mine',{kind:'MANUAL'}),enabled:!!org&&!!user,staleTime:10000,retry:false,refetchInterval:q=>q.state.data?.some(t=>t.kind==='MANUAL'&&['RUNNING','NEEDS_REVIEW'].includes(t.status))?5000:30000,refetchIntervalInBackground:false});
}

export type AdvancedStyle={
 intonation:'inherit'|'restrained'|'varied';emphasis:'inherit'|'soft'|'keypoints';
 sentenceEnding:'inherit'|'settled'|'gentle';onset:'inherit'|'soft'|'direct';
 articulation:'inherit'|'relaxed'|'clear';paceVariation:'inherit'|'steady'|'adaptive';
 fillerWords:'inherit'|'none'|'occasional';acknowledgement:'inherit'|'minimal'|'contextual';
 questionStyle:'inherit'|'one'|'confirm';numberReading:'inherit'|'careful'|'grouped';empathy:'inherit'|'restrained'|'supportive';
};
export type VoiceTuningSettings={enhanceQuietSpeech:boolean;noiseReduction:'off'|'mild';responseSpeed:'fast'|'balanced'|'patient';responseWaitMs?:number;sensitivity:'normal'|'sensitive';noInputSeconds:number;deliveryStyle:'warm'|'calm'|'bright';speakingPace:'slow'|'natural'|'brisk';pauseStyle:'connected'|'natural'|'clear';emotionLevel:'subtle'|'balanced'|'expressive';conversationalStyle:'concise'|'everyday'|'polished';replyLength:'short'|'balanced'|'detailed';followCustomerEmotion:boolean;customDirection:string;backgroundScene:'off'|'office'|'opening';backgroundVolume:number;advancedStyle?:AdvancedStyle};
