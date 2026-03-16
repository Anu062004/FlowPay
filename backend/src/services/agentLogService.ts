import { db } from "../db/pool.js";

export async function logAgentAction(
  agentName: string,
  inputSnapshot: Record<string, unknown>,
  decision: Record<string, unknown>,
  rationale: string,
  actionTaken: string,
  companyId?: string
) {
  try {
    await db.query(
      "INSERT INTO agent_logs (agent_name, input_snapshot, decision, rationale, action_taken, company_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [agentName, JSON.stringify(inputSnapshot), JSON.stringify(decision), rationale, actionTaken, companyId || null]
    );
  } catch (error) {
    console.error(`Failed to log agent action for ${agentName}:`, error);
  }
}
