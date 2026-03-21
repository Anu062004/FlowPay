"use client";

import { useEffect, useMemo, useState } from "react";
import { useInvestments, useTreasuryBalance, type InvestmentData } from "../lib/hooks";
import { loadCompanyContext, saveCompanyContext } from "../lib/companyContext";
import { getTransactionExplorerUrl } from "../lib/transactions";

type InvestmentPosition = InvestmentData["positions"][number];
type TrackedMarketAsset = NonNullable<InvestmentData["marketBoard"]>["crypto"][number];

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

function fmtEth(value: string | number, symbol = "ETH"): string {
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

function positionBadgeVariant(status: InvestmentPosition["status"]): string {
  if (status === "active") return "success";
  if (status === "sync_failed") return "danger";
  return "neutral";
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

  const positions = data?.positions ?? [];
  const transactions = data?.transactions ?? [];
  const marketBoard = data?.marketBoard;
  const treasuryAddress = treasury.data?.wallet_address ?? null;
  const treasuryBalance = treasury.data?.balance ?? "0";
  const treasuryTokenSymbol = treasury.data?.token_symbol ?? "ETH";

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

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Investments</h1>
          <p className="page-subtitle">WDK market board plus Aave v3 Sepolia positions and treasury deployment history</p>
        </div>
        <div className="row">
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
              <div className="card-subtitle">The investment agent deploys funds from and settles assets back to this treasury wallet automatically.</div>
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
                  <span>Any automated investment allocation by the agent is routed against this treasury wallet. No separate asset target needs to be configured.</span>
                </div>
              </div>
              <div className="grid-2">
                <div className="metric-card">
                  <div className="metric-card-label">Live Treasury Balance</div>
                  <div className="metric-card-value font-num">{fmtEth(treasuryBalance, treasuryTokenSymbol)}</div>
                  <div className="metric-card-change neutral">{treasuryTokenSymbol} available for allocation</div>
                </div>
                <div className="metric-card">
                  <div className="metric-card-label">Network</div>
                  <div className="metric-card-value font-num">Sepolia</div>
                  <div className="metric-card-change neutral">WDK EVM treasury wallet</div>
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

      <div className="grid-4">
        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Total Deployed</div>
            <div className="metric-card-icon icon-bg-emerald">
              <Icon d="M3 10h18M7 15h.01M11 15h.01M3 7h18a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{fmtEth(summary.totalDeployed)}</div>
          <div className="metric-card-change neutral">Capital currently or previously deployed to Aave</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-header">
            <div className="metric-card-label">Total Yield</div>
            <div className="metric-card-icon icon-bg-info">
              <Icon d="M12 3l7 4v10l-7 4-7-4V7l7-4zm0 6v6m-3-3h6" size={16} />
            </div>
          </div>
          <div className="metric-card-value font-num">{fmtEth(summary.totalYield)}</div>
          <div className="metric-card-change neutral">Yield recorded across investment positions</div>
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
                <div className="card-subtitle">Aave v3 Sepolia deployment ledger</div>
              </div>
            </div>
            {positions.length === 0 ? (
              <div className="card-body">
                <div className="empty-state" style={{ padding: "40px 0" }}>
                  <div className="empty-state-title">No investment positions found</div>
                  <div className="empty-state-desc">Run the investment agent or fund treasury allocations to create Aave positions.</div>
                </div>
              </div>
            ) : (
              <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Protocol</th>
                      <th className="right">Amount Deposited</th>
                      <th className="right">aToken Balance</th>
                      <th className="right">Yield Earned</th>
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
                        <td className="data-table-num">{fmtEth(position.amount_deposited)}</td>
                        <td className="data-table-num">{fmtEth(position.atoken_balance)}</td>
                        <td className="data-table-num">{fmtEth(position.yield_earned)}</td>
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
                        <td className="data-table-num">{fmtEth(tx.amount)}</td>
                        <td>
                          {tx.tx_hash ? (
                            <a
                              href={getTransactionExplorerUrl(tx.tx_hash)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-xs text-secondary"
                              title="Open transaction in explorer"
                            >
                              {fmtShortHash(tx.tx_hash)}
                            </a>
                          ) : (
                            <span className="font-mono text-xs text-secondary">{fmtShortHash(tx.tx_hash)}</span>
                          )}
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
