/*
 * 中文导读：知识库：workspace-knowledge.ts。相关类型、配置或辅助实现集中在本文件。
 */
import { Router, raw } from 'express';
import { z } from 'zod';
import authMiddleware from '../../middleware/auth.middleware.js';
import { authorized,requirePermission } from '../../middleware/authorize.middleware.js';
import { trustedOrigins } from '../../config/origins.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import { BadRequestError } from '../../common/errors/badRequest.js';
import * as library from './knowledge-library.js';
import { extractKnowledgeFile } from './knowledge-files.js';
import { queueKnowledgeAnalysis, knowledgeAnalysisCapability } from './knowledge-analysis.js';
import * as lifecycle from './knowledge-lifecycle.js';

const router=Router();
router.use(authMiddleware,requirePermission({knowledgeSource:['read']}));
const scope=(req:{auth:{activeOrganizationId:string;userId:string}})=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
const send=(res:{json:(v:unknown)=>unknown},data:unknown)=>res.json({success:true,data});
const itemId=z.string().min(1).max(200);
const trash=(v:unknown)=>v==='true';
router.use(authorized(async(req,res,next)=>{
 if(req.auth.authMethod!=='session'||req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('请在当前工作区登录后使用知识库。');
 if(!['GET','HEAD'].includes(req.method)){
  await library.knowledgeAccess(scope(req),'update');
  if(!trustedOrigins.includes(req.get('origin')??''))throw new ForbiddenError('请在系统正式地址维护知识库。');
 }
 res.setHeader('Cache-Control','private, no-store');next();
}));
router.get('/',authorized(async(req,res)=>send(res,await library.listKnowledgeNotes(scope(req)))));
router.get('/library',authorized(async(req,res)=>send(res,await library.knowledgeLibrary(scope(req),trash(req.query.trash),req.query.search?z.string().max(100).parse(req.query.search):''))));
router.get('/capability',authorized(async(req,res)=>send(res,await knowledgeAnalysisCapability(scope(req),req.query.agentId?itemId.parse(req.query.agentId):null))));
router.get('/health',authorized(async(req,res)=>send(res,await lifecycle.knowledgeHealth(scope(req)))));
router.get('/retrieve',authorized(async(req,res)=>send(res,await lifecycle.retrievalPreview(scope(req),req.query.agentId?itemId.parse(req.query.agentId):null,z.string().trim().min(2).max(1200).parse(req.query.question)))));
router.post('/sources/import',authorized(async(req,res)=>send(res,await lifecycle.importExistingSources(scope(req),req.body))));
router.put('/retrieval-settings',authorized(async(req,res)=>send(res,await lifecycle.setSemanticSettings(scope(req),req.body))));
router.post('/index/retry',authorized(async(req,res)=>send(res,await lifecycle.retryKnowledgeIndex(scope(req)))));
router.post('/duplicates/merge',authorized(async(req,res)=>send(res,await lifecycle.mergeDuplicateKnowledge(scope(req),req.body))));
router.get('/versions/:id',authorized(async(req,res)=>send(res,await lifecycle.knowledgeVersions(scope(req),itemId.parse(req.params.id)))));
router.post('/versions/:id/restore',authorized(async(req,res)=>send(res,await lifecycle.restoreKnowledgeVersion(scope(req),itemId.parse(req.params.id),req.body))));
router.get('/retrieval-records',authorized(async(req,res)=>send(res,await lifecycle.retrievalRecords(scope(req),z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page),req.query.callId?itemId.parse(req.query.callId):undefined))));
router.get('/gaps',authorized(async(req,res)=>send(res,await lifecycle.knowledgeGaps(scope(req),z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page),z.enum(['OPEN','RESOLVED','IGNORED']).default('OPEN').parse(req.query.status)))));
router.put('/gaps/:id',authorized(async(req,res)=>send(res,await lifecycle.updateKnowledgeGap(scope(req),itemId.parse(req.params.id),req.body))));
router.post('/gaps/:id/answer',authorized(async(req,res)=>send(res,await lifecycle.answerKnowledgeGap(scope(req),itemId.parse(req.params.id),req.body))));
router.get('/items/:kind/:id',authorized(async(req,res)=>send(res,await library.knowledgeItem(scope(req),String(req.params.kind),itemId.parse(req.params.id),trash(req.query.trash)))));
router.put('/categories/:id',authorized(async(req,res)=>send(res,await library.saveKnowledgeCategory(scope(req),itemId.parse(req.params.id),req.body))));
router.delete('/categories/:id',authorized(async(req,res)=>send(res,await library.removeKnowledgeCategory(scope(req),itemId.parse(req.params.id)))));
router.post('/documents',authorized(async(req,res)=>{
 const data=z.object({name:z.string(),content:z.string(),agentId:itemId.nullable(),categoryId:itemId.nullable().default(null)}).strict().parse(req.body);
 send(res,await library.saveKnowledgeDocument(scope(req),data));
}));
router.post('/upload',raw({type:'application/octet-stream',limit:'8mb'}),authorized(async(req,res)=>{
 if(!Buffer.isBuffer(req.body))throw new BadRequestError('请选择资料文件。');
 const name=z.string().trim().min(1).max(160).parse(req.query.name);
 const agentId=req.query.agentId?itemId.parse(req.query.agentId):null,categoryId=req.query.categoryId?itemId.parse(req.query.categoryId):null;
 const content=await extractKnowledgeFile(name,req.body);
 send(res,await library.saveKnowledgeDocument(scope(req),{name:name.replace(/\.[^.]+$/,''),content,agentId,categoryId,sourceKind:'FILE'},{name,bytes:req.body}));
}));
router.put('/documents/:id',authorized(async(req,res)=>send(res,await library.changeKnowledgeDocument(scope(req),itemId.parse(req.params.id),req.body))));
router.put('/sources/:id',authorized(async(req,res)=>send(res,await library.changeKnowledgeSource(scope(req),itemId.parse(req.params.id),req.body))));
router.post('/sources/snapshot',authorized(async(req,res)=>{
 const data=z.object({id:itemId,contentHash:z.string().length(64)}).strict().parse(req.body);
 send(res,await library.snapshotKnowledgeSource(scope(req),data.id,data.contentHash));
}));
router.post('/documents/:id/analyze',authorized(async(req,res)=>send(res,await queueKnowledgeAnalysis(scope(req),itemId.parse(req.params.id),req.body))));
router.post('/documents/:id/review',authorized(async(req,res)=>send(res,await library.reviewKnowledge(scope(req),itemId.parse(req.params.id),req.body))));
router.post('/items/:kind/:id/recycle',authorized(async(req,res)=>{
 const data=z.object({revision:z.number().int().positive(),restore:z.boolean().default(false),originStamp:z.string().length(64).optional()}).strict().parse(req.body);
 send(res,await library.recycleKnowledge(scope(req),String(req.params.kind),itemId.parse(req.params.id),data.revision,data.restore,data.originStamp));
}));
router.put('/:id',authorized(async(req,res)=>send(res,await library.saveKnowledgeNote(scope(req),itemId.parse(req.params.id),req.body))));

export {knowledgeContext} from './knowledge-retrieval.js';
export default router;
