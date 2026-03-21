import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";

const strategyIdSchema = z.enum([
  "hold_treasury_eth",
  "aave_weth_supply",
  "de_risk_to_treasury"
]);

const strategyProtocolSchema = z.enum(["treasury", "aave"]);

const investmentStrategyCandidateSchema = z.object({
  id: strategyIdSchema,
  label: z.string().min(1),
  asset_symbol: z.string().min(1),
  protocol: strategyProtocolSchema,
  available: z.boolean(),
  expected_return_score: z.number().min(0).max(10),
  risk_score: z.number().min(0).max(10),
  liquidity_score: z.number().min(0).max(10),
  payroll_safety_score: z.number().min(0).max(10),
  max_allocation_pct: z.number().min(0).max(0.2),
  notes: z.string().min(1)
});

const investmentSchema = z.object({
  action: z.enum(["invest", "hold", "withdraw"]),
  strategy_id: strategyIdSchema,
  target_asset: z.string().min(1),
  target_protocol: strategyProtocolSchema,
  allocation_pct: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  risk_level: z.enum(["low", "medium", "high"]),
  rationale: z.string().min(5)
});

export type InvestmentStrategyId = z.infer<typeof strategyIdSchema>;
export type InvestmentStrategyProtocol = z.infer<typeof strategyProtocolSchema>;
export type InvestmentStrategyCandidate = z.infer<typeof investmentStrategyCandidateSchema>;
export type InvestmentDecision = z.infer<typeof investmentSchema>;
export type InvestmentAgentInput = {
  balance: number;
  investment_pool: number;
  eth_price: number;
  price_change_pct: number;
  atoken_balance: number;
  yield_earned: number;
  open_positions: number;
  monthly_payroll: number;
  payroll_coverage_ratio: number;
  current_aave_exposure_pct: number;
  max_aave_exposure_pct: number;
  risk_tolerance: "conservative" | "moderate" | "aggressive";
  strategy_candidates: InvestmentStrategyCandidate[];
};

export async function runInvestmentAgent(input: InvestmentAgentInput) {
  return runOpenClawTask<InvestmentDecision>(
    {
      name: "investment_decision",
      systemPrompt:
        "You are FlowPay's risk-adjusted treasury investment strategist. " +
        "Choose exactly one approved strategy candidate for the investment pool.\n\n" +
        "Rules:\n" +
        "- Optimize for risk-adjusted return, not raw upside.\n" +
        "- Preserve payroll safety before seeking yield.\n" +
        "- Only choose from the supplied strategy_candidates list.\n" +
        "- Never select a candidate where available=false.\n" +
        "- Use 'invest' only for a yield strategy like aave_weth_supply.\n" +
        "- Use 'withdraw' only when de-risking back to treasury is safer than staying invested.\n" +
        "- When choosing 'invest', allocation_pct must be <= the selected candidate's max_allocation_pct.\n" +
        "- When candidates are close, choose the safer and more liquid option.\n" +
        "- Consider payroll_coverage_ratio, current_aave_exposure_pct, price_change_pct, yield_earned, and risk_tolerance.\n" +
        "- Ensure rationale explains why the chosen strategy offers the best expected return for the least acceptable risk.\n\n" +
        "Respond ONLY with a JSON object.",
      userPrompt: (payload) => 
        `Investment context: ${JSON.stringify(payload)}.\n\n` +
        "Provide your decision in JSON format: " +
        "{\"action\":\"invest\"|\"hold\"|\"withdraw\",\"strategy_id\":\"hold_treasury_eth\"|\"aave_weth_supply\"|\"de_risk_to_treasury\",\"target_asset\":\"string\",\"target_protocol\":\"treasury\"|\"aave\",\"allocation_pct\":number,\"confidence\":number,\"risk_level\":\"low\"|\"medium\"|\"high\",\"rationale\":\"string\"}",
      schema: investmentSchema,
      temperature: 0.3
    },
    input
  );
}
