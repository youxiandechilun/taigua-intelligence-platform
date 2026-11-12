/*
 * 中文导读：客户管理：customer-intent.route.ts。声明接口路径、中间件和处理函数。
 */
import {Router} from 'express';
import {Readable} from 'node:stream';
import {z} from 'zod';
import authMiddleware from '../../middleware/auth.middleware.js';
import {authorized,requirePermission} from '../../middleware/authorize.middleware.js';
import {trustedOrigins} from '../../config/origins.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import CustomApiError from '../../common/errors/customApiError.js';
import {NotFoundError} from '../../common/errors/notFound.js';
import {crmDb} from './crm.db.js';
import {memberAccess,type Scope,type CrmDb,type Row} from './crm.service.js';
import {grants} from '../workspace/company-policy.js';
import {scopedCompanyUserIds} from '../workspace/company-access.js';
import {bridgeRequest} from '../telephony/sip.service.js';
import {openCallbackRecording} from '../telephony/callback.recording.js';
import {recordingHosts} from '../telephony/callback.events.js';
import {callbackConnection} from '../telephony/callback.settings.js';
import {customerIntentCountColumns,customerCallSummaries,customerIntentCallRows} from './customer-intent.repository.js';
import {effectiveIntentCtes} from './customer-intent.live.js';
import {customerReadRevisionSql,customerReadAtSql,customerReadJoinSql} from './customer-read-state.js';
const router=Router();
const s=(req:{auth:{activeOrganizationId:string;userId:string}}):Scope=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
const id=z.string().min(1).max(100);
const stages=['pending','requested','added','sent','deferred','failed','closed'] as const;
const labels={pending:'待加微信',requested:'申请已发送',added:'已加微信',sent:'已发直播链接',deferred:'暂缓联系',failed:'添加失败',closed:'已停止联系'};
router.use(authMiddleware,requirePermission({crm:['read']}),authorized(async(req,res,next)=>{
 if(req.auth.authMethod!=='session'||(req.get('x-workspace-id')||(['GET','HEAD'].includes(req.method)&&req.path.includes('/recordings/')?req.query.workspace:undefined))!==req.auth.activeOrganizationId)throw new ForbiddenError('请在当前工作区登录后访问客户库。');
 if(!['GET','HEAD'].includes(req.method)&&!trustedOrigins.includes(req.get('origin')||''))throw new ForbiddenError('请在系统正式地址维护客户资料。');
 res.setHeader('Cache-Control','private, no-store');next();
}));
async function access(scope:Scope,db:CrmDb=crmDb){const a=await memberAccess(db,scope);return {...a,manage:a.allData&&grants(a.permissions,'crm','assign')};}
async function customer(scope:Scope,customerId:string,db:CrmDb=crmDb,allowAlias=false){
 const [a,list]=await Promise.all([access(scope,db),db.query(`${effectiveIntentCtes} SELECT c.*,u."name" AS "ownerName",${customerReadRevisionSql} AS "readRevision",${customerReadAtSql} AS "readAt" FROM effective_customers c LEFT JOIN "User" u ON u."id"=c."ownerId" ${customerReadJoinSql} WHERE c."workspaceId"=$1 AND (c."id"=$3 OR ($4::boolean AND md5(c."workspaceId"||':'||c."phone")=$3)) ORDER BY CASE WHEN c."id"=$3 THEN 0 ELSE 1 END LIMIT 1`,[scope.workspaceId,scope.userId,id.parse(customerId),allowAlias])]);
 const c=list[0];if(!c)throw new NotFoundError('客户不存在。');
 if(c.ownerId!==scope.userId&&!a.manage)throw new ForbiddenError('这位客户由其他员工负责，仅可查看脱敏概况。');return {c,a};
}
function overview(c:Row,scope:Scope,manage:boolean){const full=manage||c.ownerId===scope.userId,p=c.profile||{};return {id:c.id,phone:full?c.phone:c.phone.slice(0,3)+'****'+c.phone.slice(-4),name:full?p.name||'':'',ownerId:c.ownerId,ownerName:c.ownerName||'待分配',intent:c.intent,stage:c.stage,callCount:c.callCount||0,updatedAt:c.updatedAt,dueAt:null,readOnly:!full,readAt:full?c.readAt??null:undefined,readRevision:full?c.readRevision:undefined,temporary:c.temporary===true,recognitionStatus:c.recognitionStatus==='provisional'?'provisional':'confirmed',followedUp:p.followedUp===true,hasAddedWechat:p.hasAddedWechat===true};}
router.get('/',authorized(async(req,res)=>{
 const scope=s(req),a=await access(scope);
 const q=z.string().trim().max(100).default('').parse(req.query.q),mine=req.query.scope!=='all',stage=z.enum(stages).optional().parse(req.query.stage||undefined),intent=z.enum(['interested','unclear','uninterested','optout']).optional().parse(req.query.intent||undefined);
 const readState=z.enum(['read','unread']).optional().parse(req.query.readState||undefined);
 const page=z.coerce.number().int().min(1).max(1000000).default(1).parse(req.query.page),pageSize=20;
 const params=[scope.workspaceId,scope.userId,a.manage,mine,q,stage||null,intent||null,req.query.wechatAdded==='true'];
 const where=`c."workspaceId"=$1 AND (NOT $4 OR c."ownerId"=$2) AND ($5='' OR position(lower($5) in lower((CASE WHEN $3 OR c."ownerId"=$2 THEN c."phone"||' '||COALESCE(c."profile"->>'name','') ELSE left(c."phone",3)||'****'||right(c."phone",4) END)||' '||COALESCE(u."name",'')))>0) AND ($6::text IS NULL OR c."stage"=$6) AND ($7::text IS NULL OR c."intent"=$7) AND (NOT $8 OR c."profile"->>'hasAddedWechat'='true') AND ($11::text IS NULL OR (($3 OR c."ownerId"=$2) AND CASE WHEN $11='read' THEN ${customerReadAtSql} IS NOT NULL ELSE ${customerReadAtSql} IS NULL END))`;
 // One SQL snapshot supplies the page, total and counters. A live withdrawal
 // cannot disappear between the count query and a separate paginated query.
 const [pageRows,staff]=await Promise.all([
  crmDb.query(`${effectiveIntentCtes}, filtered_customers AS (
    SELECT c.*,u."name" AS "ownerName",${customerReadRevisionSql} AS "readRevision",${customerReadAtSql} AS "readAt" FROM effective_customers c LEFT JOIN "User" u ON u."id"=c."ownerId" ${customerReadJoinSql} WHERE ${where}
  ), library_total AS (
    SELECT count(*)::int AS total FROM filtered_customers
  ), library_page AS (
    SELECT total,LEAST($9::int,GREATEST(1,ceil(total::numeric/20)::int)) AS page FROM library_total
  ), library_counts AS (
    SELECT ${customerIntentCountColumns('TO_TIMESTAMP(0)','NOW()')} FROM effective_customers WHERE "workspaceId"=$1 AND (NOT $4 OR "ownerId"=$2)
  ), selected_customers AS (
    SELECT c.*,(SELECT count(*)::int FROM effective_calls k JOIN "CallLog" l ON l."callId"=k."callId" AND l."deleted"=false WHERE k."workspaceId"=c."workspaceId" AND k."phone"=c."phone" AND l."organizationId"=c."workspaceId" AND ($10::boolean OR c."ownerId"=$2 OR l."userId"=$2)) AS "callCount"
    FROM filtered_customers c ORDER BY c."updatedAt" DESC,c."id" LIMIT 20 OFFSET (SELECT (page-1)*20 FROM library_page)
  ) SELECT p.total,p.page,row_to_json(n) AS counts,COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c."updatedAt" DESC,c."id") FROM selected_customers c),'[]'::jsonb) AS rows
  FROM library_page p CROSS JOIN library_counts n`,[...params,page,a.canViewWorkspaceData,readState||null]),
  a.manage?crmDb.query('SELECT m."userId" AS id,u."name" FROM "Member" m JOIN "User" u ON u."id"=m."userId" WHERE m."organizationId"=$1 AND m."enabled"=true AND m."deletedAt" IS NULL AND u."banned"=false AND u."deletedAt" IS NULL ORDER BY u."name"',[scope.workspaceId]):Promise.resolve([])
 ]);
 const result=pageRows[0],rows:Row[]=Array.isArray(result?.rows)?result.rows:[];
 res.json({rows:rows.map(c=>overview(c,scope,a.manage)),total:result?.total||0,page:result?.page||1,pageSize,canAssign:a.manage,staff,counts:result?.counts||{},partial:false,syncWarning:null});
}));
router.get('/calls',authorized(async(req,res)=>{
 const ids=z.string().max(12000).optional().parse(req.query.ids)?.split(',').filter(Boolean);
 const selectedIds=ids?.length?z.array(id).max(200).parse(ids):null;
 const scope=s(req),a=await access(scope),visible=await customerIntentCallRows(crmDb,scope.workspaceId,scope.userId,a.canViewWorkspaceData,selectedIds);
 const summaries=await customerCallSummaries(crmDb,scope.workspaceId,visible.filter(c=>a.manage||c.customerOwner===scope.userId||c.ownerId===scope.userId).map(c=>c.callId));
 res.json({rows:visible.map(c=>{const full=a.manage||c.customerOwner===scope.userId,manual=c.customerIntent==='interested'&&c.manualConfirmation?.source==='admin-confirmed'&&c.manualConfirmation?.active===true&&c.manualConfirmation?.relatedCallId===c.callId;return {id:c.callId,intent:manual?'interested':c.intent,customerId:full?c.customerId||null:null,stage:full?c.stage||null:null,temporary:c.temporary===true,recognitionStatus:manual?'confirmed':c.recognitionStatus==='provisional'?'provisional':'confirmed',summary:full||c.ownerId===scope.userId?manual?'管理员人工确认该号码为意向客户；该标记不代表AI已识别需求或客户同意添加微信。':summaries.get(c.callId)?.summary||'':'',source:manual?'管理员人工确认':c.recognitionStatus==='provisional'?'通话中实时识别，待核验':c.intent==='unclear'?'暂无明确分析结果':'AI分析结果'};})});
}));
router.get('/customers/:id',authorized(async(req,res)=>{
 const scope=s(req),{c,a}=await customer(scope,String(req.params.id),crmDb,true);
  const [history, calls] = await Promise.all([crmDb.query('SELECT "at","actor","title","note" FROM "CustomerIntentHistory" WHERE "customerId"=$1 ORDER BY "at" DESC,"id" DESC LIMIT 200', [c.id]), crmDb.query(`${effectiveIntentCtes} SELECT k."callId",k."intent",k."recognitionStatus" FROM effective_calls k JOIN "CallLog" l ON l."organizationId"=k."workspaceId" AND l."callId"=k."callId" AND l."deleted"=false WHERE k."workspaceId"=$1 AND k."phone"=$2 AND ($4::boolean OR l."userId"=$3) ORDER BY k."at" DESC,k."callId" DESC`, [scope.workspaceId, c.phone, scope.userId, a.canViewWorkspaceData||c.ownerId===scope.userId])]);
 const latest=calls.find(v=>v.intent!=='unclear');
 const provisional=c.temporary===true||c.recognitionStatus==='provisional';
 const safe=!provisional&&latest?(await customerCallSummaries(crmDb,scope.workspaceId,[latest.callId])).get(latest.callId):null;
 const manual=c.intent==='interested'&&c.profile?.intentConfirmation?.source==='admin-confirmed'&&c.profile?.intentConfirmation?.active===true;
 res.json({customer:{...overview({...c,callCount:calls.length},scope,a.manage),...c.profile,company:c.profile.company||'',wechatId:c.profile.wechatId||'',wechatConsent:c.profile.wechatConsent===true,evidence:provisional||manual?c.evidence||'':safe?.evidence||'',summary:provisional?c.summary||'通话中识别到意向表达，结束后核验。':manual?c.summary:safe?.summary||'暂无可核对的客户原话，客户需求待核实。',history,callIds:calls.map(v=>v.callId),createdAt:c.createdAt,version:c.version,latestAt:c.latestAt}});
}));
router.put('/customers/:id/read-state',authorized(async(req,res)=>{
 const scope=s(req),input=z.object({read:z.boolean(),revision:z.string().regex(/^[a-f0-9]{32}$/).optional(),expectedUserId:z.string().min(1).max(100)}).strict().parse(req.body);
 if(input.expectedUserId!==scope.userId)throw new CustomApiError('登录账号已切换，请刷新后操作。',409);
 const state=await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+scope.workspaceId]);
  const {c}=await customer(scope,String(req.params.id),db,true);
  if(input.read&&input.revision!==c.readRevision)throw new CustomApiError('客户有新动态，请重新查看后再标为已读。',409);
  const key=(await db.query("SELECT md5($1||':'||$2) AS key",[scope.workspaceId,c.phone]))[0]!.key;
  if(!input.read){await db.query('DELETE FROM "CustomerIntentReadState" WHERE "workspaceId"=$1 AND "userId"=$2 AND "customerKey"=$3 RETURNING "customerKey"',[scope.workspaceId,scope.userId,key]);return {readAt:null};}
  const rows=await db.query(`INSERT INTO "CustomerIntentReadState" ("workspaceId","userId","customerKey","seenRevision") VALUES ($1,$2,$3,$4)
    ON CONFLICT ("workspaceId","userId","customerKey") DO UPDATE SET "seenRevision"=EXCLUDED."seenRevision","readAt"=CASE WHEN "CustomerIntentReadState"."seenRevision"=EXCLUDED."seenRevision" THEN "CustomerIntentReadState"."readAt" ELSE NOW() END RETURNING "readAt"`,[scope.workspaceId,scope.userId,key,c.readRevision]);
  return {readAt:rows[0]!.readAt};
 });res.json(state);
}));
router.patch('/customers/:id',authorized(async(req,res)=>{
 const scope=s(req),input=z.object({version:z.number().int().positive(),name:z.string().trim().max(200).optional(),company:z.string().trim().max(200).optional(),wechatId:z.string().trim().max(200).optional(),wechatConsent:z.boolean().optional(),stage:z.enum(stages).optional(),ownerId:z.string().min(1).max(100).optional()}).strict().parse(req.body);
 await crmDb.transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',['company-policy:'+scope.workspaceId]);
  await db.query('SELECT "id" FROM "CustomerIntentCustomer" WHERE "workspaceId"=$1 AND "id"=$2 FOR UPDATE',[scope.workspaceId,String(req.params.id)]);
  const {c,a}=await customer(scope,String(req.params.id),db);if(c.temporary===true)throw new BadRequestError('该客户来自通话中实时识别，请等待通话结束并完成核验后再保存资料。');if(c.ownerId!==scope.userId&&!grants(a.permissions,'crm','update'))throw new ForbiddenError('当前账号没有编辑客户资料权限。');
  if(c.version!==input.version)throw new CustomApiError('客户资料已被更新，请重新打开后保存。',409);
  if(input.ownerId!==undefined&&input.ownerId!==c.ownerId){if(!a.manage||!(await scopedCompanyUserIds(scope.workspaceId,scope.userId)).includes(input.ownerId)||!(await db.query('SELECT "userId" FROM "Member" m JOIN "User" u ON u."id"=m."userId" WHERE m."organizationId"=$1 AND m."userId"=$2 AND m."enabled"=true AND m."deletedAt" IS NULL AND u."banned"=false AND u."deletedAt" IS NULL',[scope.workspaceId,input.ownerId])).length)throw new ForbiddenError('无权分配给此员工。');}
  const profile={...c.profile};for(const f of ['name','company','wechatId','wechatConsent'] as const)if(input[f]!==undefined)profile[f]=input[f];
  const stage=input.stage||c.stage;
  if(input.stage){if(c.intent!=='interested'&&stage!=='closed')throw new BadRequestError('客户未表达明确意向，已停止联系。');if(['requested','added','sent'].includes(stage)&&!profile.wechatConsent)throw new BadRequestError('请先确认客户同意加微信。');if(stage==='sent'&&!profile.hasAddedWechat&&c.stage!=='added')throw new BadRequestError('请先记录已加微信。');if(['requested','added','sent','failed'].includes(stage))profile.followedUp=true;if(['added','sent'].includes(stage))profile.hasAddedWechat=true;}
  await db.query('UPDATE "CustomerIntentCustomer" SET "profile"=$3::jsonb,"stage"=$4,"ownerId"=$5,"version"="version"+1,"updatedAt"=NOW() WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"',[scope.workspaceId,c.id,JSON.stringify(profile),stage,input.ownerId??c.ownerId]);
  const actor=(await db.query('SELECT "name" FROM "User" WHERE "id"=$1',[scope.userId]))[0]?.name||'员工';
  await db.query('INSERT INTO "CustomerIntentHistory"("customerId","actor","title") VALUES ($1,$2,$3) RETURNING "id"',[c.id,actor,input.ownerId!==undefined&&input.ownerId!==c.ownerId?'调整客户负责人':input.stage?'更新微信进度：'+labels[input.stage]:'更新客户资料']);
 });res.json({saved:true});
}));
router.get('/customers/:id/calls',authorized(async(req,res)=>{
  const scope = s(req), { c, a } = await customer(scope, String(req.params.id),crmDb,true);
  const calls = await crmDb.query(`${effectiveIntentCtes} SELECT l."callId" AS id,l."startTime" AS at,l."durationSeconds" AS duration,l."status",l."audioRecordingPath",k."intent",k."summary",k."recognitionStatus" FROM effective_calls k JOIN "CallLog" l ON l."organizationId"=k."workspaceId" AND l."callId"=k."callId" AND l."deleted"=false WHERE k."workspaceId"=$1 AND k."phone"=$2 AND ($4::boolean OR l."userId"=$3) ORDER BY k."at" DESC,k."callId" LIMIT 21`, [scope.workspaceId, c.phone, scope.userId, a.canViewWorkspaceData||c.ownerId===scope.userId]);
 const ids=calls.slice(0,20).map(v=>v.id),[transcripts,summaries]=await Promise.all([ids.length?crmDb.query('SELECT "callLogId","speaker","messageText" FROM (SELECT *,row_number() OVER (PARTITION BY "callLogId" ORDER BY "timestamp","callTransId") AS rn FROM "CallTranscript" WHERE "callLogId"=ANY($1::text[])) t WHERE rn<=1001 ORDER BY "callLogId",rn',[ids]):Promise.resolve([]),customerCallSummaries(crmDb,scope.workspaceId,ids)]);
 res.json({calls:calls.slice(0,20).map(v=>{const rows=transcripts.filter(t=>t.callLogId===v.id);return {...v,summary:summaries.get(v.id)?.summary||'',audio:v.audioRecordingPath?`/api/v1/customer-followup/customers/${encodeURIComponent(c.id)}/recordings/${encodeURIComponent(v.id)}?workspace=${encodeURIComponent(scope.workspaceId)}`:null,audioRecordingPath:undefined,transcript:rows.slice(0,1000).map(t=>({speaker:['agent','assistant','bot'].includes(t.speaker.toLowerCase())?'数字员工':['customer','user'].includes(t.speaker.toLowerCase())?'客户':'其他声音',text:t.messageText})),transcriptMore:rows.length>1000};}),more:calls.length>20});
}));
router.get('/customers/:id/recordings/:callId',authorized(async(req,res)=>{
  const scope = s(req), { c, a } = await customer(scope, String(req.params.id),crmDb,true);
  const l = (await crmDb.query(`${effectiveIntentCtes} SELECT l.* FROM effective_calls k JOIN "CallLog" l ON l."organizationId"=k."workspaceId" AND l."callId"=k."callId" WHERE k."workspaceId"=$1 AND k."phone"=$2 AND k."callId"=$3 AND l."deleted"=false AND ($5::boolean OR l."userId"=$4)`, [scope.workspaceId, c.phone, id.parse(req.params.callId), scope.userId, a.canViewWorkspaceData||c.ownerId===scope.userId]))[0]; if (!l) throw new NotFoundError('录音不存在。');
 if(l.metadata?.recordingExpiredAt||(l.endTime&&new Date(l.endTime).getTime()<Date.now()-72*60*60*1000))throw new BadRequestError('录音已超过3天保留期限，无法播放。');
 if(l.metadata?.provider==='HAOKEHU_SIP'&&l.metadata.recordingFile===l.callId+'.wav'){
  const response=await bridgeRequest('/recordings/'+encodeURIComponent(l.callId),undefined,req.get('range'));if(!response.body)throw new BadRequestError('录音暂不可用。');res.status(response.status).type('audio/wav');for(const h of ['accept-ranges','content-length','content-range']){const v=response.headers.get(h);if(v)res.setHeader(h,v);}const audio=Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);audio.on('error',()=>res.destroy());res.on('close',()=>audio.destroy());audio.pipe(res);return;
 }
 let url='',hosts:string[]=[];
 if(l.metadata?.provider==='HAOKEHU_CALLBACK'){const r=(await crmDb.query('SELECT "recordingUrl","recordingState" FROM "CallbackCall" WHERE "workspaceId"=$1 AND "attemptId"=$2',[scope.workspaceId,l.callId]))[0];if(r?.recordingState!=='READY')throw new BadRequestError('录音仍在生成。');url=r.recordingUrl;hosts=recordingHosts(await callbackConnection(scope.workspaceId)||{});}
 if(l.metadata?.provider==='ALIYUN_ENGINE'){const r=(await crmDb.query('SELECT "recordingUrl" FROM "AliyunEngineCall" WHERE "workspaceId"=$1 AND "attemptId"=$2',[scope.workspaceId,l.callId]))[0];url=r?.recordingUrl||'';if(url)hosts=[new URL(url).hostname];}
 if(!url)throw new NotFoundError('该通话暂无可播放录音。');const audio=await openCallbackRecording(url,hosts,req.get('range'));res.status(audio.statusCode||200).type(String(audio.headers['content-type']||'audio/mpeg'));res.setHeader('Accept-Ranges','bytes');for(const h of ['content-length','content-range'])if(audio.headers[h])res.setHeader(h,audio.headers[h]!);audio.on('error',()=>res.destroy());res.on('close',()=>audio.destroy());audio.pipe(res);
}));
router.use((err:unknown,_req:unknown,_res:unknown,next:(err:unknown)=>void)=>next(err instanceof z.ZodError?new BadRequestError('请检查客户资料格式。'):err));
export default router;
