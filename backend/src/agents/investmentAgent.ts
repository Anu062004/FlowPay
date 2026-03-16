import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";

const investmentSchema = z.object({
  decision: z.enum(["invest", "hold", "withdraw"]),
  allocation_pct: z.number().min(0).max(0.2),
  rationale: z.string().min(5)
});

export type InvestmentDecision = z.infer<typeof investmentSchema>;

export async function runInvestmentAgent(input: {
  balance: number;
  investment_pool: number;
  eth_price: number;
  price_change_pct: number;
  atoken_balance: number;
  yield_earned: number;
  open_positions: number;
}) {
  return runOpenClawTask<InvestmentDecision>(
    {
      name: "investment_decision",
      systemPrompt:
        "You are a senior crypto investment agent for FlowPay. Your goal is to manage the company's excess investment pool by depositing ETH into Aave v3 on Sepolia to earn yield.\n\n" +
        "Rules:\n" +
        "- Cap individual allocation_pct at 0.2 (20% of the investment pool).\n" +
        "- TOTAL Aave exposure (atoken_balance) MUST NOT exceed 30% of total treasury balance.\n" +
        "- Favor 'invest' when price_change_pct is positive but stable.\n" +
        "- Favor 'hold' during high volatility or moderate price drops.\n" +
        "- Recommend 'withdraw' if risk is high, ETH price is crashing, or Aave exposure is too high.\n" +
        "- Consider existing Aave positions (atoken_balance, open_positions) and yield_earned before recommending new deposits.\n" +
        "- Ensure rationale explains the market signal and risk management logic.\n\n" +
        "Respond ONLY with a JSON object.",
      userPrompt: (payload) => 
        `Investment context: ${JSON.stringify(payload)}.\n\n` +
        "Provide your decision in JSON format: {\"decision\": \"invest\"|\"hold\"|\"withdraw\", \"allocation_pct\": number, \"rationale\": \"string\"}",
      schema: investmentSchema,
      temperature: 0.3
    },
    input
  );
}
