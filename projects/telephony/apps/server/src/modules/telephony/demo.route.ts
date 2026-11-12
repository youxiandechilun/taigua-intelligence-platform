/*
 * 中文导读：线路与语音外呼：demo.route.ts。声明接口路径、中间件和处理函数。
 */
import { Router } from 'express';
import { z } from 'zod';
import { authorized, requirePermission } from '../../middleware/authorize.middleware.js';
import type { Scope } from '../crm/crm.service.js';
import { demoConfiguration, saveDemoConfiguration, previewDemo, startDemoCall, demoCallStatus } from './demo.service.js';
import { discardTestCallDraft } from './test-calls.js';

// Mounted after SIP session, origin and workspace checks.
const router = Router();
const id = z.string().uuid();
const scope = (req:{auth:{activeOrganizationId:string;userId:string}}):Scope=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
router.get('/agents/:id/demo', authorized(async(req,res)=>res.json({success:true,data:await demoConfiguration(scope(req),id.parse(req.params.id))})));
router.put('/agents/:id/demo',requirePermission({agentConfiguration:['update']}),authorized(async(req,res)=>res.json({success:true,data:await saveDemoConfiguration(scope(req),id.parse(req.params.id),req.body)})));
router.post('/agents/:id/demo-preview',authorized(async(req,res)=>res.json({success:true,data:await previewDemo(scope(req),id.parse(req.params.id),req.body)})));
router.post('/demo-calls',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>res.json({success:true,data:await startDemoCall(scope(req),req.body)})));
router.get('/demo-calls/:id',authorized(async(req,res)=>res.json({success:true,data:await demoCallStatus(scope(req),id.parse(req.params.id))})));
router.delete('/demo-calls/:id',requirePermission({outboundCalls:['create']}),authorized(async(req,res)=>{
  const actor=scope(req),callId=id.parse(req.params.id);
  await demoCallStatus(actor,callId);
  res.json({success:true,data:await discardTestCallDraft(actor,callId)});
}));
export default router;
