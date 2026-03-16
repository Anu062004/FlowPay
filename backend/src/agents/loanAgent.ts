import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";

const loanDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  amount: z.number().positive(),
  interest: z.number().min(0).max(30),
  duration: z.number().int().min(1).max(24)
});

export type LoanDecision = z.infer<typeof loanDecisionSchema>;

export async function runLoanDecisionAgent(input: {
  salary: number;
  credit_score: number;
  requested_amount: number;
}) {
  return runOpenClawTask<LoanDecision>(
    {
      name: "loan_decision",
      systemPrompt:
        "You are a lending risk agent. Decide to approve or reject the loan. Follow rules: max loan 2x salary; max EMI 30% salary; keep interest between 3-12% unless rejecting. Respond ONLY with JSON.",
      userPrompt: (payload) => `Applicant data: ${JSON.stringify(payload)}. Return JSON {"decision":"approve|reject","amount":number,"interest":number,"duration":number}.`,
      schema: loanDecisionSchema,
      temperature: 0.2
    },
    input
  );
}
