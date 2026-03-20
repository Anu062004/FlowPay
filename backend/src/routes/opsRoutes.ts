import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/errors.js";
import { listOpsTasks, updateOpsTaskStatus, listApprovals, createOpsTask } from "../services/opsService.js";
import { approveRequest, denyRequest } from "../services/approvalService.js";
import { runAutomationJob, getAutomationStatus } from "../services/automationService.js";
import { runAutonomousDemo, runOpenClawStrategy } from "../services/orchestrationService.js";
import { runReserveTreasuryTopup } from "../services/treasuryService.js";
import {
  getAdminSupportInsights,
  answerAdminSupportQuestion
} from "../services/adminSupportService.js";

const router = Router();

const auth = (req: any, res: any, next: any) => {
  const masterKey = req.headers["x-master-key"];
  if (masterKey !== env.MASTER_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

const statusSchema = z.string().optional();
const companySchema = z.string().uuid().optional();
const createTaskSchema = z.object({
  companyId: z.string().uuid(),
  type: z.string().min(2),
  payload: z.record(z.any()).default({}),
  subject: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  approvalKind: z.string().optional()
});
const automationRunSchema = z.object({
  job: z.enum(["finance", "backend", "blockchain", "monitoring", "support", "browser", "all"]).default("all"),
  companyId: z.string().uuid().optional()
});
const orchestrationRunSchema = z.object({
  mode: z.enum(["strategy", "demo"]).default("strategy"),
  companyId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  requestedAmount: z.coerce.number().positive().optional(),
  source: z.string().min(2).optional()
});
const treasuryTopupSchema = z.object({
  companyId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  reason: z.string().min(2).optional(),
  source: z.string().min(2).optional(),
  taskId: z.string().uuid().optional()
});

router.get(
  "/tasks",
  auth,
  asyncHandler(async (req, res) => {
    const status = statusSchema.parse(req.query.status);
    const companyId = companySchema.parse(req.query.companyId);
    const type = z.string().optional().parse(req.query.type);
    const tasks = await listOpsTasks({ status, companyId, type });
    res.status(200).json({ tasks });
  })
);

router.post(
  "/tasks",
  auth,
  asyncHandler(async (req, res) => {
    const payload = createTaskSchema.parse(req.body ?? {});
    const result = await createOpsTask({
      companyId: payload.companyId,
      type: payload.type as any,
      payload: payload.payload ?? {},
      subject: payload.subject ?? null,
      recipientEmail: payload.recipientEmail ?? null,
      approvalKind: payload.approvalKind ?? null
    });
    res.status(201).json(result);
  })
);

router.post(
  "/tasks/:id/mark-sent",
  auth,
  asyncHandler(async (req, res) => {
    const taskId = z.string().uuid().parse(req.params.id);
    const updated = await updateOpsTaskStatus(taskId, "sent");
    res.status(200).json({ task: updated });
  })
);

router.post(
  "/tasks/:id/complete",
  auth,
  asyncHandler(async (req, res) => {
    const taskId = z.string().uuid().parse(req.params.id);
    const updated = await updateOpsTaskStatus(taskId, "completed");
    res.status(200).json({ task: updated });
  })
);

router.get(
  "/approvals",
  auth,
  asyncHandler(async (req, res) => {
    const status = statusSchema.parse(req.query.status);
    const companyId = companySchema.parse(req.query.companyId);
    const approvals = await listApprovals({ status, companyId });
    res.status(200).json({ approvals });
  })
);

router.post(
  "/approvals/:id/approve",
  auth,
  asyncHandler(async (req, res) => {
    const approvalId = z.string().uuid().parse(req.params.id);
    const decidedBy = z.string().optional().parse(req.body?.decidedBy);
    const decisionPayload = z.record(z.any()).optional().parse(req.body?.decisionPayload);
    const result = await approveRequest(approvalId, decidedBy, decisionPayload);
    res.status(200).json(result);
  })
);

router.post(
  "/approvals/:id/deny",
  auth,
  asyncHandler(async (req, res) => {
    const approvalId = z.string().uuid().parse(req.params.id);
    const decidedBy = z.string().optional().parse(req.body?.decidedBy);
    const decisionPayload = z.record(z.any()).optional().parse(req.body?.decisionPayload);
    const result = await denyRequest(approvalId, decidedBy, decisionPayload);
    res.status(200).json(result);
  })
);

router.get(
  "/automation/status",
  auth,
  asyncHandler(async (_req, res) => {
    res.status(200).json({ status: getAutomationStatus() });
  })
);

router.post(
  "/automation/run",
  auth,
  asyncHandler(async (req, res) => {
    const payload = automationRunSchema.parse(req.body ?? {});
    const result = await runAutomationJob(payload.job, { companyId: payload.companyId });
    res.status(200).json({ job: payload.job, result });
  })
);

router.post(
  "/orchestration/run",
  auth,
  asyncHandler(async (req, res) => {
    const payload = orchestrationRunSchema.parse(req.body ?? {});

    if (payload.mode === "demo") {
      if (!payload.companyId) {
        return res.status(400).json({ error: "companyId is required for demo mode" });
      }

      const result = await runAutonomousDemo({
        companyId: payload.companyId,
        employeeId: payload.employeeId,
        requestedAmount: payload.requestedAmount,
        source: payload.source ?? "admin_demo"
      });
      return res.status(200).json({ mode: payload.mode, result });
    }

    const result = await runOpenClawStrategy({
      companyId: payload.companyId,
      source: payload.source ?? "openclaw_ec2"
    });
    return res.status(200).json({ mode: payload.mode, result });
  })
);

router.post(
  "/treasury/topup",
  auth,
  asyncHandler(async (req, res) => {
    const payload = treasuryTopupSchema.parse(req.body ?? {});
    const result = await runReserveTreasuryTopup({
      companyId: payload.companyId,
      amount: payload.amount,
      reason: payload.reason,
      source: payload.source ?? "openclaw_clawbot",
      taskId: payload.taskId
    });
    res.status(200).json({ result });
  })
);

router.get(
  "/support/insights",
  auth,
  asyncHandler(async (req, res) => {
    const companyId = companySchema.parse(req.query.companyId);
    const question = z.string().optional().parse(req.query.question);
    const insights = await getAdminSupportInsights(companyId);
    if (!question) {
      return res.status(200).json({ insights });
    }
    const response = answerAdminSupportQuestion(insights, question);
    return res.status(200).json({ question, ...response, insights });
  })
);

export default router;
