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
  credit_score: number;
  requested_amount: number;
  eth_price_usd: number;
  price_change_24h: number;
}) {
  return runOpenClawTask<LoanDecision>(
    {
      name: "loan_decision",
      systemPrompt:
        "You are a senior lending risk agent for FlowPay. Your goal is to assess loan applications fairly while minimizing treasury risk.\n\n" +
        "Rules:\n" +
        "- Max total loan cannot exceed 2x the monthly salary.\n" +
        "- Monthly EMI must not exceed 30% of the monthly salary.\n" +
        "- Interest rates should range between 3% (low risk) and 12% (high risk).\n" +
        "- High credit scores (>700) qualify for lower interest rates.\n" +
        "- ETH Market Context: If price_change_24h is very negative (<-10%), be more conservative.\n" +
        "- Reject if the requested amount is clearly unsustainable.\n\n" +
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
