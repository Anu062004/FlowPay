import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";
import { env } from "../config/env.js";

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

type CompactInvestmentPrompt = {
  investable_eth: number;
  payroll_due_eth: number;
  payroll_cover_ratio: number;
  eth_24h_change_pct: number;
  aave_position_eth: number;
  aave_yield_eth: number;
  aave_exposure_pct: number;
  aave_exposure_cap_pct: number;
  risk_tolerance: InvestmentAgentInput["risk_tolerance"];
  open_positions: boolean;
  strategies: Array<{
    id: InvestmentStrategyId;
    asset: string;
    protocol: InvestmentStrategyProtocol;
    available: boolean;
    max_pct: number;
    return_score: number;
    risk_score: number;
    liquidity_score: number;
    payroll_safety_score: number;
    note?: string;
  }>;
};

function compactNumber(value: number) {
  return Number.isFinite(value) ? parseFloat(value.toFixed(4)) : 0;
}

function buildInvestmentPrompt(input: InvestmentAgentInput): CompactInvestmentPrompt {
  return {
    investable_eth: compactNumber(input.investment_pool),
    payroll_due_eth: compactNumber(input.monthly_payroll),
    payroll_cover_ratio: compactNumber(input.payroll_coverage_ratio),
    eth_24h_change_pct: compactNumber(input.price_change_pct),
    aave_position_eth: compactNumber(input.atoken_balance),
    aave_yield_eth: compactNumber(input.yield_earned),
    aave_exposure_pct: compactNumber(input.current_aave_exposure_pct),
    aave_exposure_cap_pct: compactNumber(input.max_aave_exposure_pct),
    risk_tolerance: input.risk_tolerance,
    open_positions: input.open_positions > 0,
    strategies: input.strategy_candidates.map((candidate) => ({
      id: candidate.id,
      asset: candidate.asset_symbol,
      protocol: candidate.protocol,
      available: candidate.available,
      max_pct: compactNumber(candidate.max_allocation_pct),
      return_score: compactNumber(candidate.expected_return_score),
      risk_score: compactNumber(candidate.risk_score),
      liquidity_score: compactNumber(candidate.liquidity_score),
      payroll_safety_score: compactNumber(candidate.payroll_safety_score),
      note:
        !candidate.available || candidate.notes.toLowerCase().includes("unavailable")
          ? candidate.notes
          : undefined
    }))
  };
}

export async function runInvestmentAgent(input: InvestmentAgentInput) {
  const promptInput = buildInvestmentPrompt(input);
  return runOpenClawTask<InvestmentDecision>(
    {
      name: "investment_decision",
      systemPrompt:
        "You are FlowPay's treasury strategy selector. Pick exactly one approved strategy.\n" +
        "Optimize for risk-adjusted return while protecting payroll liquidity.\n" +
        "Only use strategies where available=true.\n" +
        "Prefer the safer, more liquid option when scores are close.\n" +
        "Use invest only for aave_weth_supply.\n" +
        "Use withdraw only for de_risk_to_treasury.\n" +
        "allocation_pct must be 0 for hold, 1 for full de-risk, or <= selected max_pct for invest.\n" +
        "Keep rationale to one short sentence.\n" +
        "Return JSON only.",
      userPrompt: (payload) =>
        `State=${JSON.stringify(payload)}\n` +
        "Return exactly this JSON shape: " +
        "{\"action\":\"invest\"|\"hold\"|\"withdraw\",\"strategy_id\":\"hold_treasury_eth\"|\"aave_weth_supply\"|\"de_risk_to_treasury\",\"target_asset\":\"ETH\"|\"WETH\",\"target_protocol\":\"treasury\"|\"aave\",\"allocation_pct\":number,\"confidence\":number,\"risk_level\":\"low\"|\"medium\"|\"high\",\"rationale\":\"<=18 words\"}",
      schema: investmentSchema,
      temperature: 0.1,
      maxRetries: 0,
      maxOutputTokens: 140,
      providerOverride: "gemini",
      modelOverride: env.INVESTMENT_GEMINI_MODEL ?? "gemini-2.5-flash-lite",
      apiKeyOverride: env.INVESTMENT_GEMINI_API_KEY ?? env.GEMINI_API_KEY
    },
    promptInput
  );
}
