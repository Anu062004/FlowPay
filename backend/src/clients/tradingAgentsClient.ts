type TradingAgentsClientConfig = {
  url: string;
  secret: string;
  timeoutMs: number;
};

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

function requireTradingAgentsConfig(config: TradingAgentsClientConfig | null): TradingAgentsClientConfig {
  if (!config?.url || !config.secret) {
    throw new Error("TradingAgents URL and secret are required for investment automation");
  }
  return config;
}

export async function checkTradingAgentsHealth(config: TradingAgentsClientConfig | null) {
  const resolved = requireTradingAgentsConfig(config);
  const response = await fetch(`${resolved.url}/health`, {
    signal: AbortSignal.timeout(resolved.timeoutMs)
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
}, config: TradingAgentsClientConfig | null): Promise<TradingAgentsDecision> {
  const resolved = requireTradingAgentsConfig(config);

  const response = await fetch(`${resolved.url}/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      capital_usdc: input.capitalUsdc,
      horizon: input.horizon ?? "30d",
      api_secret: resolved.secret,
      current_allocation: input.currentAllocation ?? {}
    }),
    signal: AbortSignal.timeout(resolved.timeoutMs)
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
