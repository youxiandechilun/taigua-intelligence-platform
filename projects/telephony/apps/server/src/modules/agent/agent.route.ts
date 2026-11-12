/*
 * 中文导读：数字员工与话术：agent.route.ts。声明接口路径、中间件和处理函数。
 */
import {requireSystemAdmin} from '../../middleware/system-admin.middleware.js';
import {platformEnabled} from '../platform/platform-client.js';
import {syncCandidates,syncPersonalSettings} from './personal-settings-sync.js';
import { getWorkspaceProfile } from "../workspace/workspace.profile.js";
import { Router } from "express";

import authMiddleware, {
  requireInternalApiKey,
} from "../../middleware/auth.middleware.js";
import { listAgentTemplates } from "./agent.templates.js";
import {
  authorized,
  requirePermission,
} from "../../middleware/authorize.middleware.js";
import { z } from "zod";
import {
  compilePlaybook,
  playbookSchema,
  playbookSaveSchema,
  playbookVariables,
} from "./agent.playbook.js";
import { getPlaybook, savePlaybook } from "./playbook.service.js";
import validate from "../../middleware/validate.middleware.js";
import * as agentController from "./agent.controller.js";
import {
  configureAgentSchema,
  createAgentSchema,
  updateAgentSchema,
} from "./agent.schema.js";

import learningRouter from "./agent.learning.route.js";
import * as releases from './agent.release.js';
import { trustedOrigins } from '../../config/origins.js';
import { ForbiddenError } from '../../common/errors/forbidden.js';
import * as personalPlaybooks from './personal-playbook.service.js';
import { personalScript, assertPersonalChanges } from './personal-playbook.store.js';
import { canManageScripts, requireScriptManager } from './script-access.js';
const router = Router();
const releaseScope=(req:{auth:{activeOrganizationId:string;userId:string}})=>({workspaceId:req.auth.activeOrganizationId,userId:req.auth.userId});
const scriptWrite=authorized(async(req,_res,next)=>{await requireScriptManager(releaseScope(req));next();});
router.get('/script-access',authMiddleware,requirePermission({agent:['read']}),authorized(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json({success:true,data:{canManage:await canManageScripts(releaseScope(req))}});}));
router.get('/releases',authMiddleware,requirePermission({agent:['read']}),authorized(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json({success:true,data:await releases.releaseCatalog(releaseScope(req))});}));
router.get('/:agentId/release',authMiddleware,requirePermission({agent:['read']}),authorized(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json({success:true,data:await releases.releaseStatus(releaseScope(req),z.string().uuid().parse(req.params.agentId))});}));
const trainingRead=authorized(async(req,_res,next)=>{const {companyContext}=await import('../workspace/company-access.js');const context=await companyContext(req.auth.activeOrganizationId,req.auth.userId);if(!releases.canTrain(context.permissions)&&!releases.canPublish(context.permissions))throw new ForbiddenError('培训草稿由管理员维护。');next();});
const releaseWrite=authorized(async(req,_res,next)=>{if(req.auth.authMethod!=='session'||!trustedOrigins.includes(req.get('origin')||'')||req.get('x-workspace-id')!==req.auth.activeOrganizationId)throw new ForbiddenError('请在当前工作区审核与发布。');next();});
router.get('/:agentId/sync-settings',authMiddleware,authorized(async(req,res)=>{res.setHeader('Cache-Control','private, no-store');res.json({success:true,data:await syncCandidates(releaseScope(req),z.string().uuid().parse(req.params.agentId))});}));
router.post('/:agentId/sync-settings',authMiddleware,releaseWrite,authorized(async(req,res)=>res.json({success:true,data:await syncPersonalSettings(releaseScope(req),z.string().uuid().parse(req.params.agentId),req.body)})));
router.get('/:agentId/my-configuration',authMiddleware,authorized(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await personalPlaybooks.myPlaybook(releaseScope(req),z.string().uuid().parse(req.params.agentId))});
}));
router.put('/:agentId/my-configuration',authMiddleware,releaseWrite,authorized(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await personalPlaybooks.saveMyConfiguration(releaseScope(req),z.string().uuid().parse(req.params.agentId),req.body)});
}));
router.get('/:agentId/my-playbook',authMiddleware,authorized(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await personalPlaybooks.myPlaybook(releaseScope(req),z.string().uuid().parse(req.params.agentId))});
}));
router.put('/:agentId/my-playbook',authMiddleware,releaseWrite,authorized(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await personalPlaybooks.saveMyPlaybook(releaseScope(req),z.string().uuid().parse(req.params.agentId),req.body)});
}));
router.post('/:agentId/my-playbook/reset',authMiddleware,releaseWrite,authorized(async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  res.json({success:true,data:await personalPlaybooks.saveMyPlaybook(releaseScope(req),z.string().uuid().parse(req.params.agentId),req.body,true)});
}));
router.get('/:agentId/my-playbook/capabilities',authMiddleware,authorized(async(req,res)=>{
  const agentId=z.string().uuid().parse(req.params.agentId);
  const release=await personalPlaybooks.employeeRelease(releaseScope(req),agentId);
  const learning=await import('./agent.learning.js');
  res.json({success:true,data:await learning.learningCapabilities({...releaseScope(req),agentId},release.snapshot.textModelId)});
}));
router.post('/:agentId/my-playbook/rehearse',authMiddleware,releaseWrite,authorized(async(req,res)=>{
  const agentId=z.string().uuid().parse(req.params.agentId),scope=releaseScope(req);
  const release=await personalPlaybooks.employeeRelease(scope,agentId);
  const data=personalPlaybooks.personalRehearsalSchema.parse(req.body);
  const playbook=personalScript(data.playbook);
  assertPersonalChanges(release.snapshot,playbook,(await releases.publishedRelease(scope,agentId)).snapshot.playbook,data.placeholders);
  const learning=await import('./agent.learning.js');
  res.json({success:true,data:await learning.rehearseFlow({...scope,agentId},data.messages,compilePlaybook(playbook),playbook.opening,data.placeholders,release.snapshot.textModelId)});
}));
router.post('/:agentId/release',authMiddleware,requirePermission({agentConfiguration:['publish']}),releaseWrite,scriptWrite,authorized(async(req,res)=>res.json({success:true,data:await releases.publishRelease(releaseScope(req),z.string().uuid().parse(req.params.agentId),req.body)})));
router.put('/:agentId/audience',authMiddleware,requirePermission({agentConfiguration:['publish']}),releaseWrite,authorized(async(req,res)=>res.json({success:true,data:await releases.saveAudience(releaseScope(req),z.string().uuid().parse(req.params.agentId),req.body)})));

router.use("/:agentId/learning", learningRouter);
router.get(
  "/:agentId/playbook",
  authMiddleware,
  requirePermission({ agentConfiguration: ["read"] }),
  trainingRead,
  authorized(async (req, res) => {
    res.json({
      success: true,
      data: await getPlaybook(
        req.auth.activeOrganizationId,
        z.string().uuid().parse(req.params.agentId),
      ),
    });
  }),
);
router.put(
  "/:agentId/playbook",
  authMiddleware,
  requirePermission({ agentConfiguration: ["update"] }),
  scriptWrite,
  authorized(async (req, res) => {
    res.json({
      success: true,
      data: await savePlaybook(
        req.auth.activeOrganizationId,
        req.auth.userId,
        z.string().uuid().parse(req.params.agentId),
        playbookSaveSchema.parse(req.body),
      ),
    });
  }),
);
router.post(
  "/:agentId/playbook/preview",
  authMiddleware,
  requirePermission({ agentConfiguration: ["read"] }),
  trainingRead,
  authorized(async (req, res) => {
    await getPlaybook(
      req.auth.activeOrganizationId,
      z.string().uuid().parse(req.params.agentId),
    );
    const playbook = playbookSchema.parse(req.body);
    res.json({
      success: true,
      data: {
        compiledPrompt: compilePlaybook(playbook),
        variableNames: playbookVariables(playbook, {}).systemPrompt,
      },
    });
  }),
);
router.get(
  "/templates",
  authMiddleware,
  requirePermission({ agent: ["read"] }),
  authorized(async(req, res) => {
    const profile=await getWorkspaceProfile(req.auth.activeOrganizationId);
    res.json({ success: true, data: listAgentTemplates(profile.companyName) });
  }),
);

router.post(
  "/",
  authMiddleware,
  requirePermission({ agent: ["create"] }),
  (req,res,next)=>platformEnabled()?scriptWrite(req,res,next):requireSystemAdmin(req,res,next),
  validate(createAgentSchema),
  agentController.createAgent,
);

router.get(
  "/",
  authMiddleware,
  requirePermission({ agent: ["read"] }),
  agentController.getAgents,
);

router.get(
  "/voice/catalog",
  authMiddleware,
  requirePermission({ agentConfiguration: ["read"] }),
  agentController.getVoiceCatalog,
);

router.post(
  "/:agentId/preview-session",
  authMiddleware,
  requirePermission({ agentPreview: ["create"] }),
  trainingRead,
  agentController.createAgentPreviewSession,
);

router.patch(
  "/:id",
  authMiddleware,
  requirePermission({ agent: ["update"] }),
  validate(updateAgentSchema),
  agentController.updateAgent,
);

router.delete(
  "/:agentId",
  authMiddleware,
  requirePermission({ agent: ["delete"] }),
  agentController.deleteAgent,
);

router.post(
  "/:agentId/config",
  authMiddleware,
  requirePermission({ agentConfiguration: ["create", "update"] }),
  scriptWrite,
  validate(configureAgentSchema),
  agentController.configureAgent,
);

router.get(
  "/:agentId/config",
  authMiddleware,
  requirePermission({ agentConfiguration: ["read"] }),
  trainingRead,
  agentController.getAgentConfig,
);

router.get(
  "/internal-config/:agentId",
  requireInternalApiKey,
  agentController.getAgentConfigByIdForRuntime,
);

router.get(
  "/number-config/:phoneNumber",
  requireInternalApiKey,
  agentController.getAgentConfigByNumber,
);

export default router;
