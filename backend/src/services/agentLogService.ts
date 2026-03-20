import { db } from "../db/pool.js";

export type AgentPolicyResult = {
  status: "allow" | "review" | "block";
  reasons: string[];
  checks?: Array<Record<string, unknown>>;
  amount?: number;
  limits?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
};

export type AgentLogContext = {
  workflowId?: string | null;
  workflowName?: string | null;
  stage?: string;
  source?: string;
  policyResult?: AgentPolicyResult | Record<string, unknown>;
  executionStatus?: string | null;
  metadata?: Record<string, unknown>;
};

export async function logAgentAction(
  agentName: string,
  inputSnapshot: Record<string, unknown>,
  decision: Record<string, unknown>,
  rationale: string,
  actionTaken: string,
  companyId?: string,
  context: AgentLogContext = {}
) {
  try {
    await db.query(
      `INSERT INTO agent_logs
       (agent_name, input_snapshot, decision, rationale, action_taken, company_id, workflow_id, workflow_name, stage, source, policy_result, execution_status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        agentName,
        JSON.stringify(inputSnapshot),
        JSON.stringify(decision),
        rationale,
        actionTaken,
        companyId || null,
        context.workflowId ?? null,
        context.workflowName ?? null,
        context.stage ?? "decision",
        context.source ?? "backend",
        JSON.stringify(context.policyResult ?? {}),
        context.executionStatus ?? null,
        JSON.stringify(context.metadata ?? {})
      ]
    );
  } catch (error) {
    console.error(`Failed to log agent action for ${agentName}:`, error);
  }
}
