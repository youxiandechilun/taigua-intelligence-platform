/*
 * 中文导读：录音学习：learning.route.ts。声明接口路径、中间件和处理函数。
 */
import {Router} from 'express';
import {z} from 'zod';
import authMiddleware from '../../middleware/auth.middleware.js';
import {authorized,requirePermission} from '../../middleware/authorize.middleware.js';
import {companyContext} from '../workspace/company-access.js';
import {canTrain,canPublish} from '../agent/agent.release.js';
import {trustedOrigins} from '../../config/origins.js';
import {ForbiddenError} from '../../common/errors/forbidden.js';
import {workspaceLearning,learningAgents,publishLearning,unbindLearning,pilotAvailable,importPilot} from './learning.service.js';
import {requireScriptManager} from '../agent/script-access.js';
import {RECORDING_LEARNING_ENABLED,RECORDING_LEARNING_PAUSED} from './learning-availability.js';
const router=Router();
router.use(authMiddleware,requirePermission({agentConfiguration:['read']}),authorized(async(req,res,next)=>{
 if(req.auth.authMethod!=='session')throw new ForbiddenError('请登录系统后使用录音学习。');
 if(!RECORDING_LEARNING_ENABLED){
  if(!req.path.startsWith('/api/')&&req.accepts('html')){res.status(503).type('html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>录音学习暂时停用</title><body><p>录音学习暂时停用，已有资料已保留。</p></body></html>');return;}
  res.status(503).json({success:false,message:RECORDING_LEARNING_PAUSED});return;
 }
 const workspaceId=req.auth.activeOrganizationId,userId=req.auth.userId;
 const context=await companyContext(workspaceId,userId);
 if(!canTrain(context.permissions))throw new ForbiddenError('录音学习由获授权的培训负责人使用。');
 if((req.query.workspaceId!==undefined||req.path.startsWith('/api/'))&&req.query.workspaceId!==workspaceId)throw new ForbiddenError('工作区已切换，请重新打开录音学习。');
 if(!['GET','HEAD'].includes(req.method)){
  await requireScriptManager({workspaceId,userId});
  if(!trustedOrigins.includes(req.get('origin')||'')||req.get('x-workspace-id')!==workspaceId)throw new ForbiddenError('请在当前工作区操作。');
  if(req.path==='/api/publish'||req.path==='/api/unbind'){
   if(!canPublish(context.permissions))throw new ForbiddenError('发布或撤回学习包需要数字员工发布权限。');
  }
 }
 res.setHeader('Cache-Control','private, no-store');
 if(req.path==='/api/publish'&&req.method==='POST'){
  const body=z.object({agentId:z.string().uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),promptHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  res.json(await publishLearning(workspaceId,userId,body));return;
 }
 if(req.path==='/api/unbind'&&req.method==='POST'){
  const body=z.object({agentId:z.string().uuid()}).strict().parse(req.body);res.json(await unbindLearning(workspaceId,userId,body.agentId));return;
 }
 if(req.path==='/api/import-pilot'&&req.method==='POST'){
  if(!context.isSystemAdmin)throw new ForbiddenError('试用进度由系统管理员导入。');res.json(await importPilot(workspaceId,userId));return;
 }
 if(req.path==='/api/state')Object.assign(req,{learningContext:{workspaceId,canPublish:canPublish(context.permissions),agents:await learningAgents(workspaceId),pilotAvailable:context.isSystemAdmin&&await pilotAvailable()}});
 const app=await workspaceLearning(workspaceId);await app.handler(req,res);
}));
export default router;
