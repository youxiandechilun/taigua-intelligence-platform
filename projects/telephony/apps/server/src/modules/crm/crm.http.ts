/*
 * 中文导读：客户管理：crm.http.ts。相关类型、配置或辅助实现集中在本文件。
 */
import {requirePermission} from '../../middleware/authorize.middleware.js';
import {customerDialTargets} from './crm.recipients.js';
import {Router,type RequestHandler} from 'express';
import {z} from 'zod';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {crmService,memberAccess,type Scope,type Resource,type CrmDb} from './crm.service.js';
import {previewFile,importFile,importLegacy} from './crm.import.js';
import {workbook,crmTemplateWorkbook} from './crm.files.js';
import {callRows,syncExistingCalls,manualLink} from './crm.calls.js';
const authorized=(handler:(req:any,res:any,next:any)=>unknown):RequestHandler=>(req,res,next)=>{Promise.resolve().then(()=>handler(req,res,next)).catch(next);};
export function createCrmRouter(crmDb:CrmDb,authHandlers:RequestHandler[],trustedOrigins:string[]){
const api=crmService(crmDb),router=Router(),id=z.string().uuid();
const scope=(req:{auth:{activeOrganizationId:string;userId:string}}):Scope=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
const send=(res:any,data:unknown)=>res.json({success:true,data});
router.use(...authHandlers,authorized(async(req,res,next)=>{if(req.auth.authMethod!=='session')throw new ForbiddenError('请登录后使用客户库。');if(req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('工作区已切换，请刷新后再操作。');if(!['GET','HEAD'].includes(req.method)&&!trustedOrigins.includes(req.get('origin')||''))throw new ForbiddenError('请从系统页面提交操作。');await memberAccess(crmDb,scope(req));res.setHeader('Cache-Control','private, no-store');next();}));
router.use((req,res,next)=>{
 const resource='crm';
 let action=req.method==='GET'?'read':'update';
 if(req.path.startsWith('/import'))action='import';else if(req.path.startsWith('/export'))action='export';else if(req.path==='/assign')action='assign';else if(req.path.includes('/recycle')||req.path.includes('/restore')||req.path==='/merge')action='delete';else if(req.method==='POST'&&['/companies','/contacts','/leads','/tasks'].includes(req.path))action='create';
 return requirePermission({[resource]:[action]})(req,res,next);
});
router.get('/dial-targets',authorized(async(req,res)=>send(res,await customerDialTargets(crmDb,scope(req),req.query))));
router.get('/companies/:id',authorized(async(req,res)=>send(res,await api.detail(scope(req),id.parse(req.params.id)))));
router.post('/companies',authorized(async(req,res)=>send(res,await api.createCompany(scope(req),req.body))));
router.patch('/companies/:id',authorized(async(req,res)=>send(res,await api.updateCompany(scope(req),id.parse(req.params.id),req.body))));
router.post('/contacts',authorized(async(req,res)=>send(res,await api.createContact(scope(req),req.body))));
router.patch('/contacts/:id',authorized(async(req,res)=>send(res,await api.createContact(scope(req),req.body,id.parse(req.params.id)))));
router.post('/leads',authorized(async(req,res)=>send(res,await api.createLead(scope(req),req.body))));
router.patch('/leads/:id',authorized(async(req,res)=>send(res,await api.createLead(scope(req),req.body,id.parse(req.params.id)))));
router.post('/companies/:id/follow',authorized(async(req,res)=>send(res,await api.follow(scope(req),id.parse(req.params.id),req.body))));
router.post('/tasks',authorized(async(req,res)=>send(res,await api.task(scope(req),req.body))));
router.post('/tasks/:id/complete',authorized(async(req,res)=>send(res,await api.completeTask(scope(req),id.parse(req.params.id)))));
router.post('/companies/:id/recycle',authorized(async(req,res)=>send(res,await api.recycle(scope(req),id.parse(req.params.id)))));
router.post('/companies/:id/restore',authorized(async(req,res)=>send(res,await api.recycle(scope(req),id.parse(req.params.id),true))));
router.post('/assign',authorized(async(req,res)=>{const p=z.object({ids:z.array(id).min(1).max(500),ownerId:z.string().min(1).max(100),authorizedUserIds:z.array(z.string().min(1).max(100)).max(100).optional()}).strict().parse(req.body);send(res,await api.assign(scope(req),p.ids,p.ownerId,p.authorizedUserIds));}));
router.post('/merge',authorized(async(req,res)=>{const p=z.object({sourceId:id,targetId:id}).strict().parse(req.body);send(res,await api.merge(scope(req),p.sourceId,p.targetId));}));
const file=z.object({name:z.string().max(200),content:z.string().max(5600000).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict();
router.post('/import/preview',authorized(async(req,res)=>{const p=file.parse(req.body);send(res,await previewFile(crmDb,scope(req),p.name,p.content));}));
router.post('/import/commit',authorized(async(req,res)=>{const p=file.parse(req.body);send(res,await importFile(crmDb,scope(req),p.name,p.content));}));
router.get('/import/template',authorized(async(_req,res)=>{res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent('客户导入模板.xlsx')).send(crmTemplateWorkbook());}));
router.post('/import/legacy',authorized(async(req,res)=>send(res,await importLegacy(crmDb,scope(req)))));
router.post('/calls/sync',authorized(async(req,res)=>send(res,await syncExistingCalls(crmDb,scope(req)))));
router.post('/calls/link',authorized(async(req,res)=>{const p=z.object({companyId:id,callId:z.string().min(1).max(200),contactId:id.nullable().default(null)}).strict().parse(req.body);send(res,await manualLink(crmDb,scope(req),p.companyId,p.callId,p.contactId));}));
router.get('/calls',authorized(async(req,res)=>send(res,await callRows(crmDb,scope(req),req.query))));
router.get('/trash',authorized(async(req,res)=>{if(!(await memberAccess(crmDb,scope(req))).permissions.crm?.includes('delete'))throw new ForbiddenError('客户回收站仅管理员可访问。');send(res,await api.list(scope(req),'companies',req.query,true));}));
router.get('/export/:resource',authorized(async(req,res)=>{const resource=z.enum(['companies','contacts','leads','tasks','calls']).parse(req.params.resource);const all:any[]=[];for(let page=1;;page++){const q={...req.query,page,pageSize:100};const result=resource==='calls'?await callRows(crmDb,scope(req),q):await api.list(scope(req),resource,q);if(result.total>10000)throw new BadRequestError('导出超过10000条，请先筛选后分批导出。');all.push(...result.rows);if(page*100>=result.total)break;}const fields:Record<string,[string,string][]>= {companies:[['name','企业名称'],['industry','行业'],['region','地区'],['address','地址'],['business','经营业务'],['website','官网'],['creditCode','统一社会信用代码'],['phone','企业联系电话'],['source','来源'],['ownerName','负责人'],['status','客户状态'],['tags','标签'],['createdAt','创建时间'],['updatedAt','更新时间']],contacts:[['companyName','企业名称'],['name','联系人姓名'],['position','职位'],['mobile','手机号码'],['areaCode','座机区号'],['landline','座机号码'],['extension','分机'],['email','邮箱'],['wechatNote','微信备注'],['status','联系状态'],['doNotCall','拒呼状态']],leads:[['companyName','企业名称'],['status','状态'],['notes','跟进备注'],['nextFollowUp','下次跟进时间']],tasks:[['companyName','企业名称'],['title','任务'],['notes','备注'],['ownerName','负责人'],['dueAt','到期时间'],['status','任务状态']],calls:[['companyName','企业名称'],['contactName','联系人'],['taskId','外呼任务编号'],['callId','通话ID'],['startTime','拨打时间'],['status','接通状态'],['durationSeconds','通话时长（秒）'],['result','通话结果'],['transcript','转写文本'],['summary','AI总结'],['intent','客户意向'],['nextAction','下一步动作'],['recordingUrl','录音地址']]};const labels:Record<string,string>={REVIEW:'待审核',READY:'待拨打',CONNECTED:'已接通',INTERESTED:'有意向',FOLLOW_UP:'跟进中',WON:'已成交',INVALID:'无效线索',OPT_OUT:'拒绝联系',PENDING:'待完成',DONE:'已完成',CANCELLED:'已取消',COMPLETED:'已接通',NOT_ANSWERED:'未接通',FAILED:'失败',IN_PROGRESS:'进行中'};const names={companies:'企业客户',contacts:'联系人',leads:'线索池',tasks:'跟进任务',calls:'客户通话记录'};const cols=fields[resource]!;const rows=all.map(r=>cols.map(([k])=>Array.isArray(r[k])?k==='transcript'?r[k].map((t:any)=>(t.speaker==='customer'?'客户':t.speaker==='agent'?'数字员工':t.speaker)+'：'+t.messageText).join('\n'):r[k].join('、'):typeof r[k]==='boolean'?r[k]?'已拒呼':'未拒呼':r[k] instanceof Date?r[k].toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):['status','intent'].includes(k)?labels[r[k]]||r[k]||'':r[k]??''));res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(names[resource]+'.xlsx'));res.send(workbook(cols.map(c=>c[1]),rows,names[resource],[['数据范围','当前工作区、当前筛选条件下的全部授权记录；最多10000条。']]));}));
for(const resource of ['companies','contacts','leads','tasks'] as Resource[])router.get('/'+resource,authorized(async(req,res)=>send(res,await api.list(scope(req),resource,req.query))));
router.use((error:any,_req:any,_res:any,next:any)=>{if(error instanceof z.ZodError)return next(new BadRequestError('提交字段格式不正确，请检查名称、日期、联系方式和状态。'));if(error?.code==='23505'||error?.meta?.code==='23505')return next(new BadRequestError('存在相同企业、信用代码或电话的记录。请先核对或合并客户。'));next(error);});
return router;
}
