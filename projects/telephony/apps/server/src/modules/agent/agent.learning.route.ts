/*
 * 中文导读：数字员工与话术：agent.learning.route.ts。声明接口路径、中间件和处理函数。
 */
import {Router,raw} from 'express';
import {z} from 'zod';
import authMiddleware from '../../middleware/auth.middleware.js';
import {authorized,requirePermission} from '../../middleware/authorize.middleware.js';
import {companyContext} from '../workspace/company-access.js';
import {canTrain} from './agent.release.js';
import {trustedOrigins} from '../../config/origins.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {BadRequestError} from '../../common/errors/badRequest.js';
import {compilePlaybook,playbookSchema,playbookOpening} from './agent.playbook.js';
import {getPlaybook} from './playbook.service.js';
import * as service from './agent.learning.js';
import {recordingKnowledge} from '../kb/recording-knowledge.js';
import {requireScriptManager} from './script-access.js';
import {RECORDING_LEARNING_ENABLED,RECORDING_LEARNING_PAUSED} from '../recording-learning/learning-availability.js';
const router=Router({mergeParams:true});const uuid=z.string().uuid();
router.use(authMiddleware,requirePermission({agentConfiguration:['read']}),authorized(async(req,res,next)=>{
 if(req.auth.authMethod!=='session')throw new ForbiddenError('请登录系统后使用对练与录音学习。');
 if(!RECORDING_LEARNING_ENABLED&&(req.path==='/recordings'||req.path.startsWith('/recordings/'))){res.status(503).json({success:false,message:RECORDING_LEARNING_PAUSED});return;}
 const context=await companyContext(req.auth.activeOrganizationId,req.auth.userId);
 if(!canTrain(context.permissions))throw new ForbiddenError('训练与录音学习由获授权的培训负责人使用。');
 if(!['GET','HEAD'].includes(req.method)){
  if(!trustedOrigins.includes(req.get('origin')||'')||req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('请在当前工作区操作。');
  await requireScriptManager({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
  if(!canTrain((await companyContext(req.auth.activeOrganizationId,req.auth.userId)).permissions))throw new ForbiddenError('培训权限已变更，请联系负责人。');
 }
 await getPlaybook(req.auth.activeOrganizationId,uuid.parse(req.params.agentId));
 res.setHeader('Cache-Control','private, no-store');next();
}));
const scope=(req:{params:Record<string,unknown>;auth:{activeOrganizationId:string;userId:string}})=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId,agentId:uuid.parse(req.params.agentId)});
const send=(res:{json:(v:unknown)=>unknown},data:unknown)=>res.json({success:true,data});
router.get('/sessions',authorized(async(req,res)=>send(res,await service.rehearsalHistory(scope(req)))));
router.post('/sessions',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>send(res,await service.saveRehearsal(scope(req),req.body))));
router.get('/recordings',authorized(async(req,res)=>send(res,await service.learningList(scope(req)))));
router.get('/recordings/:id',authorized(async(req,res)=>send(res,await service.learningDetail(scope(req),uuid.parse(req.params.id)))));
router.get('/capabilities',authorized(async(req,res)=>send(res,await service.learningCapabilities(scope(req)))));
router.post('/recordings',requirePermission({agentConfiguration:['update']}),raw({type:'audio/wav',limit:'20mb'}),authorized(async(req,res)=>{
 if(req.get('x-recording-consent')!=='yes'||!Buffer.isBuffer(req.body))throw new BadRequestError('请确认已取得录音使用授权。');
 let name='通话录音';try{name=decodeURIComponent(req.get('x-recording-name')||name);}catch{}
 send(res,await service.uploadLearning(scope(req),name,req.body,req.get('x-recording-auto-learn')==='yes'));
}));
router.post('/recordings/:id/learn',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>{
 const data=z.object({consented:z.literal(true),retryConfirmed:z.literal(true).optional()}).strict().parse(req.body);send(res,await service.startLearning(scope(req),uuid.parse(req.params.id),data.retryConfirmed===true));
}));
router.post('/recordings/:id/knowledge',requirePermission({knowledgeSource:['update']}),authorized(async(req,res)=>send(res,await recordingKnowledge(scope(req),uuid.parse(req.params.id)))));
router.patch('/recordings/:id/analysis',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>send(res,await service.saveLearningReview(scope(req),uuid.parse(req.params.id),req.body))));
router.delete('/recordings/:id',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>send(res,await service.archiveLearning(scope(req),uuid.parse(req.params.id)))));
router.get('/recordings/:id/audio',authorized(async(req,res)=>res.type('audio/wav').send(await service.learningAudio(scope(req),uuid.parse(req.params.id)))));
router.post('/rehearse',requirePermission({agentPreview:['create']}),authorized(async(req,res)=>{
 const data=z.object({messages:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().min(1).max(4000)}).strict()).min(1).max(20),playbook:playbookSchema,placeholders:z.record(z.string().max(100),z.string().max(4000)).refine(v=>Object.keys(v).length<=100).optional()}).strict().parse(req.body);
 send(res,await service.rehearseFlow(scope(req),data.messages,compilePlaybook(data.playbook),playbookOpening(data.playbook),data.placeholders)); 
}));
export default router;
