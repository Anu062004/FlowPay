import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";

const investmentSchema = z.object({
  decision: z.enum(["invest", "hold"]),
  allocation_pct: z.number().min(0).max(0.2),
  rationale: z.string().min(3)
});

export type InvestmentDecision = z.infer<typeof investmentSchema>;

export async function runInvestmentAgent(input: {
  balance: number;
  investment_pool: number;
  eth_price: number;
  price_change_pct: number;
}) {
  return runOpenClawTask<InvestmentDecision>(
    {
      name: "investment_decision",
      systemPrompt:
        "You are a crypto investment agent. Decide whether to invest a small portion of the investment pool based on ETH price change. Cap allocation_pct at 0.2. Respond ONLY with JSON.",
      userPrompt: (payload) =>
        `Market context: ${JSON.stringify(payload)}. Return JSON {"decision":"invest|hold","allocation_pct":number,"rationale":string}.`,
      schema: investmentSchema,
      temperature: 0.3
    },
    input
  );
}
