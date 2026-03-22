import { env } from "../config/env.js";

export type TradingAgentsAllocationAction =
  | "deposit"
  | "swap_to_pt"
  | "supply";

export type TradingAgentsAllocationItem = {
  percent: number;
  amount_usdc: number;
  protocol: string;
  action: TradingAgentsAllocationAction;
};

export type TradingAgentsDecision = {
  action: "DEPOSIT" | "REBALANCE" | "HOLD" | "WITHDRAW";
  allocation: Record<string, TradingAgentsAllocationItem>;
  reasoning: string;
  defi_snapshot: string;
  confidence: number;
  model_used: string;
};

function requireTradingAgentsConfig() {
  if (!env.TRADING_AGENTS_URL || !env.TRADING_AGENTS_SECRET) {
    throw new Error("TRADING_AGENTS_URL and TRADING_AGENTS_SECRET are required for investment automation");
  }
}

export async function checkTradingAgentsHealth() {
  requireTradingAgentsConfig();
  const response = await fetch(`${env.TRADING_AGENTS_URL}/health`, {
    signal: AbortSignal.timeout(parseInt(env.TRADING_AGENTS_TIMEOUT_MS, 10))
  });
  if (!response.ok) {
    throw new Error(`TradingAgents health check failed with status ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

export async function analyzeInvestmentAllocation(input: {
  capitalUsdc: number;
  horizon?: string;
  currentAllocation?: Record<string, number>;
}): Promise<TradingAgentsDecision> {
  requireTradingAgentsConfig();

  const response = await fetch(`${env.TRADING_AGENTS_URL}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      capital_usdc: input.capitalUsdc,
      horizon: input.horizon ?? "30d",
      api_secret: env.TRADING_AGENTS_SECRET,
      current_allocation: input.currentAllocation ?? {}
    }),
    signal: AbortSignal.timeout(parseInt(env.TRADING_AGENTS_TIMEOUT_MS, 10))
  });

  if (!response.ok) {
    throw new Error(`TradingAgents analyze request failed with status ${response.status}: ${await response.text()}`);
  }

  const decision = (await response.json()) as TradingAgentsDecision;
  decision.allocation = Object.fromEntries(
    Object.entries(decision.allocation ?? {}).filter(([, item]) => item.amount_usdc > 0 && item.percent > 0)
  );
  return decision;
}
