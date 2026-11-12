/*
 * 中文导读：阿里云连接：aliyun.route.ts。声明接口路径、中间件和处理函数。
 */
import { canTrain,canPublish } from '../agent/agent.release.js';
import { Router } from "express";
import { z } from "zod";
import authMiddleware from "../../middleware/auth.middleware.js";
import {
  authorized,
  requirePermission,
} from "../../middleware/authorize.middleware.js";
import { requireBuiltInBillingManager } from "../billing/billing-manager.middleware.js";
import { BadRequestError } from "../../common/errors/badRequest.js";
import { parseBatchRecipients } from "../outbound/outbound-batch-parser.js";
import {
  bindingSchema,
  communicationBindingSchema,
  connectionSchema,
  rehearsalSchema,
  recipientSchema,
  taskSchema,
  profileSaveSchema,
} from "./aliyun.schema.js";
import * as communication from "./aiccs.service.js";
import * as service from "./aliyun.service.js";

import * as agentConsole from "./agent-console.service.js";
import * as cloudSettings from "./cloud-settings.service.js";
import { companyContext } from "../workspace/company-access.js";
import { ForbiddenError } from "../../common/errors/forbidden.js";
import { requireScriptManager } from "../agent/script-access.js";
import { aliyunImportTemplateWorkbook } from "../crm/crm.files.js";

const router = Router();
router.use(authMiddleware);
router.use((_req, _res, next) => {
  try {
    service.assertAliyunBackend();
    next();
  } catch (e) {
    next(e);
  }
});
const trainingRead=authorized(async(req,_res,next)=>{const c=await companyContext(req.auth.activeOrganizationId,req.auth.userId);if(!canTrain(c.permissions)&&!canPublish(c.permissions))throw new ForbiddenError('培训草稿由获授权的负责人查看。');next();});
router.use('/tasks',authorized(async(req,_res,next)=>{if(!(await companyContext(req.auth.activeOrganizationId,req.auth.userId)).isSystemAdmin)throw new ForbiddenError('历史云端任务由系统超级管理员维护。');next();}));
const read = requirePermission({ outboundCalls: ["read"] });
const write = requirePermission({ outboundCalls: ["create"] });
const configure = requirePermission({ agentConfiguration: ["update"] });
const send = (
  res: Parameters<Parameters<typeof authorized>[0]>[1],
  data: unknown,
) => res.json({ success: true, data });
const idSchema = z.string().uuid();
const manager = authorized(async (req, _res, next) => {
  const c = await companyContext(
    req.auth.activeOrganizationId,
    req.auth.userId,
  );
  if (!c.canManage) throw new ForbiddenError("请由公司管理员调整云端绑定。");
  next();
});
const scriptManager = authorized(async (req, _res, next) => {
  await requireScriptManager({ workspaceId: req.auth.activeOrganizationId, userId: req.auth.userId });
  next();
});
router.use((req, _res, next) => {
  const expected = req.headers["x-workspace-id"];
  if (expected && expected !== req.auth?.activeOrganizationId)
    return next(new BadRequestError("工作区已切换，请重新加载后操作。"));
  next();
});
router.post("/catalog/:kind", requirePermission({ agentConfiguration: ["read"] }), authorized(async (req, res, next) => {
  const kind = z.enum(["agents", "voices", "instances", "seat-numbers"]).parse(req.params.kind);
  if (kind !== "voices") {
    const company = await companyContext(req.auth.activeOrganizationId, req.auth.userId);
    if (!company.canManage) throw new ForbiddenError("云端资源列表由公司管理员管理。");
  }
  send(res, await cloudSettings.catalog(req.auth.activeOrganizationId, kind, cloudSettings.catalogQuerySchema.parse(req.body ?? {})));
}));
router.get("/agents/:id/voice-profile", requirePermission({ agentConfiguration: ["read"] }), trainingRead, authorized(async (req, res) => send(res, await cloudSettings.getProfile(req.auth.activeOrganizationId, idSchema.parse(req.params.id)))));
router.put("/agents/:id/voice-profile", configure, authorized(async (req, res) => send(res, await cloudSettings.saveProfile(req.auth.activeOrganizationId, req.auth.userId, idSchema.parse(req.params.id), profileSaveSchema.parse(req.body)))));
router.get("/agents/:id/results",requirePermission({callLogs:["read"]}),authorized(async(req,res)=>send(res,await agentConsole.agentStatus(req.auth.activeOrganizationId,idSchema.parse(req.params.id),req.auth.userId,true))));
router.get(
  "/agents/:id/status",
  requirePermission({ agentConfiguration: ["read"] }),
  trainingRead,
  authorized(async (req, res) =>
    send(
      res,
      await agentConsole.agentStatus(
        req.auth.activeOrganizationId,
        idSchema.parse(req.params.id),
        req.auth.userId,
      ),
    ),
  ),
);
router.post(
  "/agents/:id/cloud",
  requirePermission({ agentConfiguration: ["read"] }),
  trainingRead,
  authorized(async (req, res) =>
    send(
      res,
      await agentConsole.agentCloud(
        req.auth.activeOrganizationId,
        idSchema.parse(req.params.id),
      ),
    ),
  ),
);
router.get(
  "/agents/:id/script-export",
  requirePermission({ agentConfiguration: ["read"] }),
  trainingRead,
  authorized(async (req, res) =>
    send(
      res,
      await agentConsole.scriptExport(
        req.auth.activeOrganizationId,
        idSchema.parse(req.params.id),
      ),
    ),
  ),
);

router.get(
  "/connection",
  requirePermission({ agentConfiguration: ["read"] }),
  authorized(async (req, res) =>
    send(res, await service.getConnection(req.auth.activeOrganizationId)),
  ),
);
router.put(
  "/connection",
  configure,
  requireBuiltInBillingManager,
  authorized(async (req, res) =>
    send(
      res,
      await service.saveConnection(
        req.auth.activeOrganizationId,
        req.auth.userId,
        connectionSchema.parse(req.body),
      ),
    ),
  ),
);
router.post(
  "/resources",
  requirePermission({ agentConfiguration: ["read"] }),
  authorized(async (req, res) =>
    send(res, await service.cloudResources(req.auth.activeOrganizationId)),
  ),
);
router.put(
  "/agents/:id/binding",
  configure,
  manager,
  scriptManager,
  authorized(async (req, res) =>
    send(
      res,
      await service.saveBinding(
        req.auth.activeOrganizationId,
        idSchema.parse(req.params.id),
        bindingSchema.parse(req.body).scriptId,
      ),
    ),
  ),
);
router.put(
  "/agents/:id/communication-binding",
  configure,
  manager,
  scriptManager,
  authorized(async (req, res) =>
    send(
      res,
      await communication.saveBinding(
        req.auth.activeOrganizationId,
        idSchema.parse(req.params.id),
        communicationBindingSchema.parse(req.body),
      ),
    ),
  ),
);
router.post(
  "/rehearse",
  requirePermission({ agentPreview: ["create"] }),
  trainingRead,
  authorized(async (req, res) => {
    const input = rehearsalSchema.parse(req.body);
    send(
      res,
      await service.rehearse(
        req.auth.activeOrganizationId,
        input.agentId,
        input.messages,
      ),
    );
  }),
);
router.post(
  "/import",
  write,
  authorized(async (req, res) => {
    const input = z
      .object({
        fileName: z.string().regex(/\.(csv|xlsx)$/i),
        content: z.string().min(1).max(4000000),
      })
      .strict()
      .parse(req.body);
    const file = Buffer.from(input.content, "base64");
    if (file.length > 2000000) throw new BadRequestError("文件不能超过 2 MB。");
    let parsed: ReturnType<typeof parseBatchRecipients>;
    try {
      parsed = parseBatchRecipients(file, input.fileName, {domesticOnly:true});
    } catch {
      throw new BadRequestError(
        "无法读取表格，请使用 CSV 或 XLSX，并包含联系电话列。",
      );
    }
    if (parsed.validRows.length + parsed.invalidRows.length > 2000)
      throw new BadRequestError("每个任务最多导入 2000 行，请拆分表格。");
    const recipients: z.infer<typeof recipientSchema>[] = [];
    const invalidRows = parsed.invalidRows.map((r) => ({
      rowNumber: r.rowNumber,
      phoneNumber: r.phoneNumber,
      error: r.error,
    }));
    const seen = new Set<string>();
    let duplicates = 0;
    for (const row of parsed.validRows) {
      const result = recipientSchema.safeParse({
        phoneNumber: row.phoneNumber,
        name: row.values.company_name || row.values.name || "",
        variables: row.dynamicVariables,
      });
      if (!result.success) {
        invalidRows.push({
          rowNumber: row.rowNumber,
          phoneNumber: row.phoneNumber,
          error: result.error.issues.map((i) => i.message).join("；"),
        });
        continue;
      }
      if (seen.has(result.data.phoneNumber)) {
        duplicates++;
        continue;
      }
      seen.add(result.data.phoneNumber);
      recipients.push(result.data);
    }
    send(res, { recipients, invalidRows, duplicates });
  }),
);
router.get(
  "/import/template",
  read,
  authorized(async (_req, res) => {
    res
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .setHeader("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent("外呼客户导入模板.xlsx"))
      .send(aliyunImportTemplateWorkbook());
  }),
);
router.get(
  "/tasks",
  read,
  authorized(async (req, res) =>
    send(res, await service.listTasks(req.auth.activeOrganizationId, req.auth.userId)),
  ),
);
router.post(
  "/tasks",
  write,
  authorized(async (req, res) =>
    send(
      res,
      await service.createTask(
        req.auth.activeOrganizationId,
        req.auth.userId,
        taskSchema.parse(req.body),
      ),
    ),
  ),
);
router.post(
  "/tasks/:id/publish",
  write,
  authorized(async (req, res) =>
    send(
      res,
      await service.publishTask(
        req.auth.activeOrganizationId,
        req.auth.userId,
        idSchema.parse(req.params.id),
      ),
    ),
  ),
);
router.post(
  "/tasks/:id/start",
  write,
  requireBuiltInBillingManager,
  authorized(async (req, res) => {
    const { confirmation } = z
      .object({ confirmation: z.string().uuid() })
      .strict()
      .parse(req.body);
    send(
      res,
      await service.startTask(
        req.auth.activeOrganizationId,
        req.auth.userId,
        idSchema.parse(req.params.id),
        confirmation,
      ),
    );
  }),
);
router.post(
  "/tasks/:id/stop",
  requirePermission({ outboundCalls: ["delete"] }),
  authorized(async (req, res) =>
    send(
      res,
      await service.stopTask(
        req.auth.activeOrganizationId,
        req.auth.userId,
        idSchema.parse(req.params.id),
      ),
    ),
  ),
);
router.post(
  "/tasks/:id/sync",
  read,
  authorized(async (req, res) =>
    send(
      res,
      await service.syncTask(
        req.auth.activeOrganizationId,
        req.auth.userId,
        idSchema.parse(req.params.id),
      ),
    ),
  ),
);
router.post(
  "/tasks/:id/reconcile",
  write,
  requireBuiltInBillingManager,
  authorized(async (req, res) => {
    const { remoteId } = z
      .object({ remoteId: z.string().trim().min(1).max(200) })
      .strict()
      .parse(req.body);
    send(
      res,
      await service.reconcileTask(
        req.auth.activeOrganizationId,
        req.auth.userId,
        idSchema.parse(req.params.id),
        remoteId,
      ),
    );
  }),
);
router.get(
  "/tasks/:id/calls/:sessionId",
  requirePermission({ callLogs: ["read"] }),
  authorized(async (req, res) =>
    send(
      res,
      await service.callDetail(
        req.auth.activeOrganizationId,
        req.auth.userId,
        idSchema.parse(req.params.id),
        z.string().min(1).max(200).parse(req.params.sessionId),
      ),
    ),
  ),
);
export default router;
