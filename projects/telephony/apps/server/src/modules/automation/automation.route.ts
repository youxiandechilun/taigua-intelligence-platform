/*
 * 中文导读：自动化流程：automation.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router } from 'express';
import { z } from 'zod';
import authMiddleware from '../../middleware/auth.middleware.js';
import { authorized, requirePermission } from '../../middleware/authorize.middleware.js';
import { trustedOrigins } from '../../config/origins.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { companyContext } from '../workspace/company-access.js';
import * as service from './automation.service.js';
const router=Router();const id=z.string().uuid();const kind=z.enum(service.kinds);
router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
router.post('/engine/:id/:step',authorized(async(req,res)=>{
 const runId=id.parse(req.params.id);const token=req.get('x-automation-token')??'';
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))throw new ForbiddenError('此接口仅供服务器工作流使用。');
 const step=z.enum(['context','prepare','finish']).parse(req.params.step);
 if(step==='context')await service.engineRun(runId,token);
 else if(step==='prepare')await service.prepareRun(runId,token);
 else await service.finishRun(runId,token);
 // The engine receives only its scoped run credential, never cloud keys or customer records.
 res.json({runId,token,step});
}));
router.use(authMiddleware,requirePermission({automation:['read']}));
router.use((req,_res,next)=>{
 if(req.auth?.authMethod!=='session')return next(new ForbiddenError('请登录后使用自动化。'));
 if(req.get('x-workspace-id')!==req.auth.activeOrganizationId)return next(new ForbiddenError('工作区已切换，请刷新。'));
 if(!['GET','HEAD'].includes(req.method)&&!trustedOrigins.includes(req.get('origin')||''))return next(new ForbiddenError('请在系统正式地址操作。'));
 next();
});
const scope=async(req:Parameters<Parameters<typeof authorized>[0]>[0]):Promise<service.Scope>=>{
 const ctx=await companyContext(req.auth.activeOrganizationId,req.auth.userId);
 return {organizationId:req.auth.activeOrganizationId,ownerId:req.auth.userId,canManage:ctx.canManage};
};
const send=(res:Parameters<Parameters<typeof authorized>[0]>[1],data:unknown)=>res.json({success:true,data});
const deleted=(value:unknown)=>z.enum(['true','false']).default('false').parse(value)==='true';
const batch=z.object({ids:z.array(z.string().min(1).max(100)).min(1).max(100),restore:z.boolean()}).strict();
router.get('/templates',authorized(async(req,res)=>send(res,await service.templateList(await scope(req),deleted(req.query.deleted)))));
router.post('/templates/batch',requirePermission({automation:['delete']}),authorized(async(req,res)=>{const data=batch.parse(req.body);send(res,await service.changeTemplates(await scope(req),data.ids,data.restore));}));
router.get('/templates/:templateId/download',authorized(async(req,res)=>{const file=await service.workspaceTemplateFile(await scope(req),z.string().regex(/^\d+$/).parse(req.params.templateId));res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.send(file.body);}));
router.get('/learning',authorized(async(req,res)=>send(res,await service.learningDrafts(await scope(req),deleted(req.query.deleted)))));
router.post('/learning/batch',requirePermission({automation:['delete']}),authorized(async(req,res)=>{const data=z.object({ids:z.array(id).min(1).max(100),restore:z.boolean()}).strict().parse(req.body);send(res,await service.changeLearningDrafts(await scope(req),data.ids,data.restore));}));
router.post('/learning',requirePermission({automation:['create']}),authorized(async(req,res)=>send(res,await service.saveLearningDraft(await scope(req),z.object({id:id.optional(),templateId:z.string().regex(/^\d+$/),name:z.string().trim().min(1).max(100),notes:z.string().max(6000)}).strict().parse(req.body)))));
router.get('/learning/:id/download',authorized(async(req,res)=>{const file=await service.learningDraftFile(await scope(req),id.parse(req.params.id));res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.send(file.body);}));
router.put('/personal/:kind',requirePermission({automation:['update']}),authorized(async(req,res)=>send(res,await service.savePersonalRule(await scope(req),z.enum(service.personalKinds).parse(req.params.kind),z.object({enabled:z.boolean(),dailyHour:z.number().int().min(0).max(23)}).strict().parse(req.body)))));
router.post('/personal/:kind/run',requirePermission({automation:['update']}),authorized(async(req,res)=>send(res,await service.runPersonal(await scope(req),z.enum(service.personalKinds).parse(req.params.kind)))));
router.get('/',authorized(async(req,res)=>send(res,await service.overview(await scope(req),z.enum(['mine','company']).default('mine').parse(req.query.view)))));
router.put('/rules/:kind',requirePermission({automation:['update']}),authorized(async(req,res)=>send(res,await service.updateRule(await scope(req),kind.parse(req.params.kind),z.object({enabled:z.boolean(),dailyHour:z.number().int().min(0).max(23),ownerId:z.string().min(1).max(200)}).strict().parse(req.body)))));
router.post('/rules/:kind/run',requirePermission({automation:['update']}),authorized(async(req,res)=>send(res,await service.runNow(await scope(req),kind.parse(req.params.kind)))));
router.post('/runs/:id/retry',requirePermission({automation:['update']}),authorized(async(req,res)=>send(res,await service.retryRun(await scope(req),id.parse(req.params.id)))));
router.get('/runs/:id/download',authorized(async(req,res)=>{const file=await service.download(await scope(req),id.parse(req.params.id));res.setHeader('Content-Type',file.type);res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.send(file.body);}));
router.post('/todos/:id/done',requirePermission({automation:['update']}),authorized(async(req,res)=>send(res,await service.closeTodo(await scope(req),id.parse(req.params.id)))));
export default router;
