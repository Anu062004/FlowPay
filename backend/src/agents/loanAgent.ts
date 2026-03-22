import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";

const loanDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  amount: z.number().positive(),
  interest: z.number().min(0).max(30),
  duration: z.number().int().min(1).max(24),
  rationale: z.string().min(5)
});

export type LoanDecision = z.infer<typeof loanDecisionSchema> & Record<string, unknown>;

export async function runLoanDecisionAgent(input: {
  salary: number;
  tier_label: string;
  tier_limit_amount: number;
  max_multiplier: number;
  interest_rate: number;
  proof_verified: boolean;
  requested_amount: number;
  repayment_rate: number;
  avg_days_to_close: number;
  missed_emi_count: number;
  closed_loans_count: number;
  has_prior_loans: boolean;
}) {
  return runOpenClawTask<LoanDecision>(
    {
      name: "loan_decision",
      systemPrompt:
        "You are a senior lending risk agent for FlowPay. Your goal is to assess loan applications fairly while minimizing treasury risk.\n\n" +
        "Hard rules:\n" +
        "- The backend has already blocked any applicant below the 450 score floor. Do not add any raw score reasoning because you never receive the raw score.\n" +
        "- The request has already passed FlowPayCore eligibility checks and zero-knowledge tier proof verification.\n" +
        "- proof_verified must be true, otherwise reject.\n" +
        "- Keep the approved amount at or below the requested amount.\n" +
        "- Keep the approved amount at or below tier_limit_amount.\n" +
        "- Monthly EMI must not exceed 30% of the monthly salary.\n" +
        "- Interest rates should range between 3% (low risk) and 12% (high risk).\n" +
        "- No prior loans means neutral history. Do not treat repayment_rate = 0 as bad if has_prior_loans is false.\n" +
        "- If tier_label is 450-499 and has_prior_loans is true and repayment_rate < 0.7, reject.\n" +
        "- If tier_label is 450-499 and the request is approvable, cap approval at 50% of tier_limit_amount.\n" +
        "- For repayment history: repayment_rate >= 0.9 can use the full tier limit, 0.7-0.9 can use up to 75% of tier limit, and < 0.7 can use up to 50% of tier limit.\n" +
        "- Higher missed_emi_count and longer avg_days_to_close should make the decision more conservative.\n\n" +
        "Respond ONLY with a JSON object.",
      userPrompt: (payload) => 
        `Applicant data & Market context: ${JSON.stringify(payload)}.\n\n` +
        "Provide your decision in JSON format: {\"decision\": \"approve\"|\"reject\", \"amount\": number, \"interest\": number, \"duration\": number, \"rationale\": \"string\"}",
      schema: loanDecisionSchema,
      temperature: 0.2
    },
    input
  );
}
