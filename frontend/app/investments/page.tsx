"use client";

import { useEffect, useMemo, useState } from "react";
import TransactionHashCell from "../components/TransactionHashCell";
import { useInvestments, useTreasuryBalance, type InvestmentData } from "../lib/hooks";
import { runInvestment as runInvestmentRequest, type InvestmentRunResult } from "../lib/api";
import { loadCompanyContext, saveCompanyContext } from "../lib/companyContext";

type InvestmentPosition = InvestmentData["positions"][number];
type TrackedMarketAsset = NonNullable<InvestmentData["marketBoard"]>["crypto"][number];
type TradingAgentsDecision = NonNullable<NonNullable<InvestmentData["trading_agents"]>["latestDecision"]>;
type TradingAgentsAllocationEntry = TradingAgentsDecision["allocation"][number];

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="wallet-address-copy"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
    >
      <Icon
        d={copied
          ? "M5 13l4 4L19 7"
          : "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"}
        size={14}
      />
    </button>
  );
}

function fmtToken(value: string | number, symbol = "USDT"): string {
  const parsed = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return `0.000000 ${symbol}`;
  }
  return `${parsed.toFixed(6)} ${symbol}`;
}

function fmtUsd(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 1000 ? 2 : 4,
    maximumFractionDigits: value >= 1000 ? 2 : 6
  }).format(value);
}

function fmtPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function fmtConfidence(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "--";
  }

  return `${(value * 100).toFixed(0)}%`;
}

function fmtDate(value: string | null): string {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fmtShortHash(value: string | null): string {
  if (!value) {
    return "--";
  }

  return `${value.slice(0, 12)}...${value.slice(-6)}`;
}

function fmtProtocolLabel(value: string): string {
  return value
    .split("_")
    .map((part) => {
      if (part.toUpperCase() === "USDC" || part.toUpperCase() === "USDT" || part.toUpperCase() === "PT") {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function positionBadgeVariant(status: InvestmentPosition["status"]): string {
  if (status === "active") return "success";
  if (status === "sync_failed") return "danger";
  return "neutral";
}

function tradingAgentsBadgeVariant(configured: boolean, reachable: boolean): string {
  if (!configured) return "warning";
  return reachable ? "success" : "danger";
}

function tradingAgentsBadgeLabel(configured: boolean, reachable: boolean): string {
  if (!configured) return "Not Configured";
  return reachable ? "Healthy" : "Unreachable";
}

function decisionBadgeVariant(action: string | null): string {
  if (action === "DEPOSIT") return "success";
  if (action === "REBALANCE") return "warning";
  if (action === "WITHDRAW") return "danger";
  return "neutral";
}

function getHealthModel(health: Record<string, unknown> | null | undefined) {
  if (!health || typeof health !== "object") {
    return null;
  }

  const llm = (health as Record<string, unknown>).llm;
  if (!llm || typeof llm !== "object") {
    return null;
  }

  const model = (llm as Record<string, unknown>).model;
  return typeof model === "string" ? model : null;
}

function renderChangeClass(changePct24h: number | null): string {
  if (changePct24h === null || !Number.isFinite(changePct24h)) {
    return "text-secondary";
  }

  if (changePct24h > 0) {
    return "text-success";
  }

  if (changePct24h < 0) {
    return "text-danger";
  }

  return "text-secondary";
}

function MarketTable({
  title,
  subtitle,
  assets,
  showRank
}: {
  title: string;
  subtitle: string;
  assets: TrackedMarketAsset[];
  showRank?: boolean;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          <div className="card-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              {showRank && <th>#</th>}
              <th>Asset</th>
              <th className="right">Price (USD)</th>
              <th className="right">24h</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={`${asset.category}-${asset.symbol}`}>
                {showRank && <td className="text-sm text-secondary">{asset.rank}</td>}
                <td>
                  <div className="fw-medium text-sm">{asset.name}</div>
                  <div className="text-xs text-secondary font-mono">{asset.symbol}/USD</div>
                </td>
                <td className="data-table-num">{fmtUsd(asset.price)}</td>
                <td className={`data-table-num ${renderChangeClass(asset.changePct24h)}`}>
                  {fmtPct(asset.changePct24h)}
                </td>
                <td>
                  {asset.available ? (
                    <Badge variant="success">Live</Badge>
                  ) : (
                    <Badge variant="warning">No Quote</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function InvestmentsPage() {
  const { data, loading, error, refetch } = useInvestments();
  const treasury = useTreasuryBalance();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<InvestmentRunResult | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const positions = data?.positions ?? [];
  const transactions = data?.transactions ?? [];
  const marketBoard = data?.marketBoard;
  const tradingAgents = data?.trading_agents ?? null;
  const latestDecision = tradingAgents?.latestDecision ?? null;
  const treasuryAddress = treasury.data?.wallet_address ?? null;
  const treasuryBalance = treasury.data?.balance ?? "0";
  const treasuryTokenSymbol = treasury.data?.token_symbol ?? "USDT";
  const executionTokenSymbol = data?.execution_token_symbol ?? treasuryTokenSymbol;
  const tradingAgentsHealthModel = useMemo(() => getHealthModel(tradingAgents?.health ?? null), [tradingAgents?.health]);
  const decisionAllocation = latestDecision?.allocation ?? [];

  const summary = useMemo(() => {
    const totalDeployed = positions.reduce((sum, item) => sum + parseFloat(item.amount_deposited), 0);
    const totalYield = positions.reduce((sum, item) => sum + parseFloat(item.yield_earned), 0);
    const activePositions = positions.filter((item) => item.status === "active").length;
    return { totalDeployed, totalYield, activePositions };
  }, [positions]);

  const liveTrackedMarkets = useMemo(() => {
    if (!marketBoard) {
      return 0;
    }

    return [...marketBoard.crypto, ...marketBoard.metals].filter((asset) => asset.available).length;
  }, [marketBoard]);

  useEffect(() => {
    const context = loadCompanyContext();
    setCompanyId(context?.id ?? null);
  }, []);

  useEffect(() => {
    if (!treasuryAddress) {
      return;
    }

    const context = loadCompanyContext();
    if (!context?.id || context.treasuryAddress === treasuryAddress) {
      return;
    }

    saveCompanyContext({
      ...context,
      treasuryAddress
    });
  }, [treasuryAddress]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      treasury.refetch();
    }, 30 * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [treasury.refetch]);

  async function handleRunTradingAgents() {
    const activeCompanyId = companyId ?? loadCompanyContext()?.id ?? null;
    if (!activeCompanyId) {
      setRunError("No active company session found.");
      setRunMessage(null);
      setRunResult(null);
      return;
    }

    setRunning(true);
    setRunError(null);
    setRunMessage(null);

    try {
      const result = await runInvestmentRequest(activeCompanyId);
      setRunResult(result);
      setRunMessage(
        result.txHashes.length > 0
          ? `TradingAgents returned ${result.action} and submitted ${result.txHashes.length} execution transaction${result.txHashes.length === 1 ? "" : "s"}.`
          : `TradingAgents returned ${result.action}. No execution transaction was submitted in this run.`
      );
      await Promise.all([refetch(), treasury.refetch()]);
    } catch (runErr) {
      setRunResult(null);
      setRunError(runErr instanceof Error ? runErr.message : "Failed to run TradingAgents.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Investments</h1>
          <p className="page-subtitle">TradingAgents-driven stablecoin treasury allocations with automated execution across supported DeFi venues</p>
        </div>
        <div className="row">
          <button
            className="btn btn-primary btn-sm"
            onClick={handleRunTradingAgents}
            disabled={running || !companyId || !treasuryAddress}
          >
            <Icon d="M5 12h14M13 5l7 7-7 7" size={14} />
            {running ? "Running TradingAgents..." : "Run TradingAgents"}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              refetch();
              treasury.refetch();
            }}
            disabled={loading}
          >
            <Icon d="M4 4v5h.582M20 20v-5h-.581M5.8 9A7 7 0 0119 11m-.8 4A7 7 0 015 13" size={14} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger">
          <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
          <span>{error}</span>
        </div>
      )}

      {runError && (
        <div className="alert alert-danger">
          <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
          <span>{runError}</span>
        </div>
      )}

      {runMessage && (
        <div className="alert alert-success">
          <span className="alert-icon"><Icon d="M5 13l4 4L19 7" size={16} /></span>
          <span>{runMessage}</span>
        </div>
      )}

      {marketBoard && (
        <div className="alert alert-info">
          <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
          <span>
            Prices are fetched via WDK Bitfinex pricing and auto-refresh every 30 seconds. Crypto rank order uses {marketBoard.rankingSource === "cmc" ? "the latest market-cap list" : "a curated fallback list"}, while all displayed quotes come from WDK.
          </span>
        </div>
      )}

      {treasuryAddress ? (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Treasury Assignment Wallet</div>
              <div className="card-subtitle">TradingAgents recommendations are executed from and settled back to this treasury wallet.</div>
            </div>
            <Badge variant="success">Connected</Badge>
          </div>
          <div className="card-body">
            <div className="grid-2" style={{ alignItems: "start" }}>
              <div className="stack" style={{ gap: 12 }}>
                <div>
                  <div className="text-sm text-secondary" style={{ marginBottom: 8 }}>Wallet Address</div>
                  <div className="wallet-address" style={{ maxWidth: "100%" }}>
                    <span className="wallet-address-text" style={{ userSelect: "all" }}>{treasuryAddress}</span>
                    <CopyButton text={treasuryAddress} />
                  </div>
                </div>
                <div className="alert alert-info">
                  <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
                  <span>FlowPay validates policy first, then executes approved allocations against this treasury wallet. Protocol deployments can use a separate execution asset from treasury settlement when the treasury remains in a different stablecoin.</span>
                </div>
              </div>
              <div className="grid-2">
                <div className="metric-card">
                  <div className="metric-card-label">Live Treasury Balance</div>
                  <div className="metric-card-value font-num">{fmtToken(treasuryBalance, treasuryTokenSymbol)}</div>
                  <div className="metric-card-change neutral">{treasuryTokenSymbol} available for investment allocation</div>
                </div>
                <div className="metric-card">
                  <div className="metric-card-label">Network</div>
                  <div className="metric-card-value font-num">Ethereum</div>
                  <div className="metric-card-change neutral">Treasury wallet used for DeFi protocol execution</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : treasury.loading ? (
        <div className="card">
          <div className="card-body">
            <div className="text-sm text-secondary">Checking treasury wallet assignment...</div>
          </div>
        </div>
      ) : (
        <div className="alert alert-warning">
          <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
          <span>No treasury wallet is attached to the active company yet, so the investment agent has nowhere to assign funds.</span>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">TradingAgents Control Plane</div>
            <div className="card-subtitle">Live service health, executable protocols, and the latest recommendation captured by FlowPay for this company.</div>
          </div>
          <Badge
            variant={tradingAgentsBadgeVariant(
              tradingAgents?.configured ?? false,
              tradingAgents?.reachable ?? false
            )}
          >
            {tradingAgentsBadgeLabel(
              tradingAgents?.configured ?? false,
              tradingAgents?.reachable ?? false
            )}
          </Badge>
        </div>
        <div className="card-body">
          <div className="grid-2" style={{ alignItems: "start" }}>
            <div className="stack" style={{ gap: 12 }}>
              <div className="grid-2">
                <div className="metric-card">
                  <div className="metric-card-label">Service Model</div>
                  <div className="metric-card-value" style={{ fontSize: "1rem" }}>
                    {tradingAgentsHealthModel ?? "Unavailable"}
                  </div>
                  <div className="metric-card-change neutral">Remote decision engine currently configured for the investment rail</div>
                </div>
                <div className="metric-card">
                  <div className="metric-card-label">Executable Protocols</div>
                  <div className="metric-card-value font-num">
                    {tradingAgents?.executable_protocols?.length ?? 0}
                  </div>
                  <div className="metric-card-change neutral">
                    {(tradingAgents?.executable_protocols ?? []).map(fmtProtocolLabel).join(", ") || "None enabled"}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-sm text-secondary" style={{ marginBottom: 8 }}>TradingAgents Endpoint</div>
                <div className="wallet-address" style={{ maxWidth: "100%" }}>
                  <span className="wallet-address-text" style={{ userSelect: "all" }}>
                    {tradingAgents?.url ?? "Not configured"}
                  </span>
                  {tradingAgents?.url ? <CopyButton text={tradingAgents.url} /> : null}
                </div>
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {(tradingAgents?.enabled_protocols ?? []).map((protocol) => (
                  <Badge key={protocol} variant="neutral">{fmtProtocolLabel(protocol)}</Badge>
                ))}
              </div>

              {tradingAgents?.healthError ? (
                <div className="alert alert-warning">
                  <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                  <span>{tradingAgents.healthError}</span>
                </div>
              ) : (
                <div className="alert alert-info">
                  <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
                  <span>
                    TradingAgents health checks are passing. Timeout budget: {tradingAgents?.timeout_ms ?? 0} ms.
                  </span>
                </div>
              )}
            </div>

            <div className="stack" style={{ gap: 12 }}>
              <div className="grid-2">
                <div className="metric-card">
                  <div className="metric-card-label">Latest Action</div>
                  <div className="metric-card-value font-num">{latestDecision?.action ?? "No Run Yet"}</div>
                  <div className="metric-card-change neutral">Last recommendation logged by FlowPay</div>
                </div>
                <div className="metric-card">
                  <div className="metric-card-label">Confidence</div>
                  <div className="metric-card-value font-num">{fmtConfidence(latestDecision?.confidence ?? null)}</div>
                  <div className="metric-card-change neutral">
                    {latestDecision?.timestamp ? `Captured ${fmtDate(latestDecision.timestamp)}` : "Run the investment agent to create a recommendation"}
                  </div>
                </div>
              </div>

              {latestDecision ? (
                <>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                    <div className="stack" style={{ gap: 4 }}>
                      <div className="fw-medium text-sm">Latest Recommendation</div>
                      <div className="text-xs text-secondary">
                        Model {latestDecision.model_used ?? "unknown"} • execution status {latestDecision.execution_status ?? "n/a"}
                      </div>
                    </div>
                    <Badge variant={decisionBadgeVariant(latestDecision.action)}>{latestDecision.action ?? "Unknown"}</Badge>
                  </div>
                  <div className="alert alert-info">
                    <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
                    <span>{latestDecision.reasoning || "No reasoning was stored for the latest recommendation."}</span>
                  </div>

                  {decisionAllocation.length > 0 ? (
                    <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Protocol</th>
                            <th>Action</th>
                            <th className="right">Allocation</th>
                            <th className="right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {decisionAllocation.map((item: TradingAgentsAllocationEntry) => (
                            <tr key={item.protocolKey}>
                              <td>
                                <div className="fw-medium text-sm">{fmtProtocolLabel(item.protocolKey)}</div>
                                <div className="text-xs text-secondary">{item.protocol}</div>
                              </td>
                              <td className="text-sm text-secondary">{item.action ?? "--"}</td>
                              <td className="data-table-num">{fmtPct(item.percent * 100)}</td>
                              <td className="data-table-num">{fmtToken(item.amount_usdc, executionTokenSymbol)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="card" style={{ border: "1px dashed var(--border-default)", boxShadow: "none" }}>
                      <div className="card-body">
                        <div className="text-sm text-secondary">The latest recommendation did not allocate any executable capital.</div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="card" style={{ border: "1px dashed var(--border-default)", boxShadow: "none" }}>
                  <div className="card-body">
                    <div className="empty-state" style={{ padding: "28px 0" }}>
                      <div className="empty-state-title">No TradingAgents recommendation logged yet</div>
                      <div className="empty-state-desc">Use the action above to run the investment engine and capture the first on-platform recommendation for this company.</div>
                    </div>
                  </div>
                </div>
              )}

              {runResult ? (
                <div className="alert alert-success">
                  <span className="alert-icon"><Icon d="M5 13l4 4L19 7" size={16} /></span>
                  <span>
                    Most recent manual run returned {runResult.action} with {fmtConfidence(runResult.confidence)} confidence and {runResult.txHashes.length} execution transaction{runResult.txHashes.length === 1 ? "" : "s"}.
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-4">
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Total Deployed</div>
            <div className="metric-card-icon icon-bg-emerald">
              <Icon d="M3 10h18M7 15h.01M11 15h.01M3 7h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{fmtToken(summary.totalDeployed, executionTokenSymbol)}</div>
          <div className="metric-card-change neutral">Capital currently or previously deployed across investment protocols</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Total Yield</div>
            <div className="metric-card-icon icon-bg-info">
              <Icon d="M12 3l7 4v10l-7 4-7-4V7l7-4zm0 6v6m-3-3h6" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{fmtToken(summary.totalYield, executionTokenSymbol)}</div>
          <div className="metric-card-change neutral">Yield recorded across deployed investment positions</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Active Positions</div>
            <div className="metric-card-icon icon-bg-warning">
              <Icon d="M4 19h16M5 15l4-4 3 3 7-8" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{summary.activePositions}</div>
          <div className="metric-card-change neutral">{positions.length} total recorded positions</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">WDK Feed Coverage</div>
            <div className="metric-card-icon icon-bg-blue">
              <Icon d="M12 20v-6m0 0V4m0 10l-3-3m3 3l3-3M5 8l-2 2m16-2l2 2M5 16l-2-2m16 2l2-2" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{liveTrackedMarkets}</div>
          <div className="metric-card-change neutral">Live tracked assets across crypto and metals</div>
        </div>
      </div>

      {loading ? (
        <div className="card">
          <div className="card-body">
            <div className="text-sm text-secondary">Loading investment data and WDK price board...</div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid-2">
            <MarketTable
              title="Top 20 Crypto"
              subtitle={`Live WDK prices${marketBoard ? ` • Updated ${fmtDate(marketBoard.updatedAt)}` : ""}`}
              assets={marketBoard?.crypto ?? []}
              showRank
            />
            <MarketTable
              title="Precious Metals"
              subtitle="Gold, silver, platinum, and palladium tracked through WDK-compatible symbols"
              assets={marketBoard?.metals ?? []}
            />
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Investment Positions</div>
                <div className="card-subtitle">Execution-asset deployment ledger across supported protocols</div>
              </div>
            </div>
            {positions.length === 0 ? (
                <div className="card-body">
                  <div className="empty-state" style={{ padding: "40px 0" }}>
                    <div className="empty-state-title">No investment positions found</div>
                    <div className="empty-state-desc">Run the investment cycle or fund treasury allocations to create supported protocol positions.</div>
                  </div>
                </div>
            ) : (
              <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Protocol</th>
                      <th className="right">Amount Deposited</th>
                      <th className="right">Reported Balance</th>
                      <th className="right">Yield Recorded</th>
                      <th>Status</th>
                      <th>Opened At</th>
                      <th>Closed At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((position) => (
                      <tr key={position.id}>
                        <td>
                          <div className="fw-medium text-sm">{position.protocol}</div>
                          <div className="text-xs text-secondary font-mono">{position.id.slice(0, 8)}...</div>
                        </td>
                        <td className="data-table-num">{fmtToken(position.amount_deposited, executionTokenSymbol)}</td>
                        <td className="data-table-num">{fmtToken(position.atoken_balance, executionTokenSymbol)}</td>
                        <td className="data-table-num">{fmtToken(position.yield_earned, executionTokenSymbol)}</td>
                        <td>
                          <Badge variant={positionBadgeVariant(position.status)}>
                            {position.status}
                          </Badge>
                        </td>
                        <td className="text-sm text-secondary">{fmtDate(position.opened_at)}</td>
                        <td className="text-sm text-secondary">{fmtDate(position.closed_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Investment Transfers</div>
                <div className="card-subtitle">Treasury transactions tagged as investment activity</div>
              </div>
            </div>
            {transactions.length === 0 ? (
              <div className="card-body">
                <div className="text-sm text-secondary">No investment transfer history yet.</div>
              </div>
            ) : (
              <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="right">Amount</th>
                      <th>Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="text-sm text-secondary">{fmtDate(tx.created_at)}</td>
                        <td className="data-table-num">{fmtToken(tx.amount, tx.token_symbol ?? executionTokenSymbol)}</td>
                        <td>
                          <TransactionHashCell
                            txHash={tx.tx_hash}
                            fallbackLabel={fmtShortHash(tx.tx_hash)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
