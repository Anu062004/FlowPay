"use client";
import { useInvestments } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import { loadCompanyContext } from "../lib/companyContext";
import { useState } from "react";

// ── Re-usable chart components (no external deps) ─────────────

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function fmt(val: string | number | null | undefined, prefix = "$"): string {
  if (val === null || val === undefined) return "—";
  const n = parseFloat(String(val));
  return isNaN(n) ? "—" : `${prefix}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtChange(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "--";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}%`;
}

function fmtCompactUsd(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(val);
  return `$${formatted}`;
}


function Skeleton({ h = 20, w = "100%" }: { h?: number; w?: string }) {
  return <div style={{ height: h, width: w, background: "var(--gray-100)", borderRadius: 4 }} />;
}

// Area chart derived from investment transaction timestamps
function AreaChart({ transactions, height = 160 }: {
  transactions: { amount: string; created_at: string }[];
  height?: number;
}) {
  if (transactions.length === 0) return (
    <div className="empty-state" style={{ padding: "32px 0" }}>
      <div className="empty-state-desc">No investment activity yet.</div>
    </div>
  );

  // Cumulative sum by date
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  let cum = 0;
  const points = sorted.map(t => {
    cum += parseFloat(t.amount);
    return { label: new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }), value: cum };
  });

  const values = points.map(p => p.value);
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const w = 400, h = height;
  const color = "#10b981";

  const pts = values.map((v, i) => ({
    x: (i / Math.max(values.length - 1, 1)) * w,
    y: h - ((v - min) / range) * (h - 12) - 4,
  }));
  const linePath = `M ${pts.map(p => `${p.x},${p.y}`).join(" L ")}`;
  const areaPath = `${linePath} L ${w},${h} L 0,${h} Z`;

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h + 24}`} preserveAspectRatio="none" style={{ display: "block", height: height + 24 }}>
      <defs>
        <linearGradient id="inv-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.14" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#inv-grad)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" fill={color} />)}
      {points.map((p, i) => (
        <text key={i} x={pts[i].x} y={h + 18}
          textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
          style={{ fontSize: 10, fill: "#94a3b8" }}>{p.label}</text>
      ))}
    </svg>
  );
}

// Pool allocation donut
function PoolDonut({ investPool, payrollPool, lendingPool }: {
  investPool: number; payrollPool: number; lendingPool: number;
}) {
  const segments = [
    { label: "Investment Pool", value: investPool,  color: "#2563eb" },
    { label: "Payroll Reserve", value: payrollPool, color: "#10b981" },
    { label: "Lending Pool",    value: lendingPool, color: "#f59e0b" },
  ].filter(s => s.value > 0);

  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  let cum = 0;

  if (segments.length === 0) return (
    <div className="empty-state" style={{ padding: "24px 0" }}>
      <div className="empty-state-desc">No allocation configured yet.</div>
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
      <svg width="100" height="100" style={{ flexShrink: 0 }}>
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dash = circ * pct, gap = circ - dash;
          const rot = (cum / total) * 360 - 90;
          cum += seg.value;
          return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color}
            strokeWidth="16" strokeDasharray={`${dash} ${gap}`}
            transform={`rotate(${rot} ${cx} ${cy})`} />;
        })}
        <circle cx={cx} cy={cy} r={r - 10} fill="white" />
        <text x={cx} y={cy - 3} textAnchor="middle" style={{ fontSize: 8, fontWeight: 700, fill: "#0f172a" }}>ALLOC</text>
        <text x={cx} y={cy + 9} textAnchor="middle" style={{ fontSize: 8, fill: "#64748b" }}>${(total / 1000).toFixed(0)}K</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
            <span className="text-sm text-secondary" style={{ flex: 1 }}>{seg.label}</span>
            <span className="fw-semi font-num text-sm">{fmt(seg.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
export default function InvestmentsPage() {
  const { data, loading, error, refetch } = useInvestments();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const summary = data?.summary;
  const txList = data?.transactions ?? [];
  const allocation = data?.allocation;
  const market = data?.market ?? null;
  const marketTop = data?.marketTop ?? [];

  const investPool   = parseFloat(allocation?.investment_pool ?? "0");
  const payrollPool  = parseFloat(allocation?.payroll_reserve ?? "0");
  const lendingPool  = parseFloat(allocation?.lending_pool ?? "0");
  const totalInvested = parseFloat(summary?.total_invested ?? "0");

  async function handleRunAgent() {
    const ctx = typeof window !== "undefined" ? loadCompanyContext() : null;
    if (!ctx?.id) return;
    setRunning(true);
    setRunResult(null);
    try {
      const result = await apiFetch<{ decision: string; invested_amount?: number; rationale?: string }>(
        "/investments/run",
        { method: "POST", body: JSON.stringify({ companyId: ctx.id }) }
      );
      setRunResult(
        result.decision === "hold"
          ? "Agent decision: hold — no action taken."
          : `Agent invested ${fmt(result.invested_amount)}. Rationale: ${result.rationale ?? "—"}`
      );
      refetch();
    } catch (err: any) {
      setRunResult(`Error: ${err.message}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Investments</h1>
          <p className="page-subtitle">AI-managed capital allocation and portfolio performance</p>
        </div>
        <div className="row">
          <Badge variant="accent">AI Agent Active</Badge>
          <button className="btn btn-secondary" onClick={refetch} disabled={loading}>Refresh</button>
          <button className="btn btn-primary" onClick={handleRunAgent} disabled={running || loading}>
            <Icon d="M12 4v16m8-8H4" size={14} />
            {running ? "Running Agent…" : "Run AI Agent"}
          </button>
        </div>
      </div>

      {runResult && (
        <div className={`alert ${runResult.startsWith("Error") ? "alert-danger" : "alert-success"}`}>
          <span className="alert-icon"><Icon d={runResult.startsWith("Error") ? "M6 18L18 6M6 6l12 12" : "M5 13l4 4L19 7"} size={16} /></span>
          <span>{runResult}</span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid-4">
        {[
          { label: "Total Invested",     value: loading ? "—" : fmt(totalInvested),                       sub: `${txList.length} investment transactions` },
          { label: "Investment Pool",    value: loading ? "—" : fmt(investPool),                           sub: "Configured allocation" },
          { label: "Payroll Reserve",    value: loading ? "—" : fmt(payrollPool),                          sub: "Reserved for payroll" },
          { label: "Lending Pool",       value: loading ? "—" : fmt(lendingPool),                          sub: "Reserved for loans" },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {loading ? <Skeleton h={36} /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
            <div className="metric-card-change neutral">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Market snapshot */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Market Snapshot</div>
            <div className="card-subtitle">Latest ETH price for agent decisions</div>
          </div>
          {market ? (
            <Badge variant={market.change_pct >= 0 ? "success" : "warning"}>
              {fmtChange(market.change_pct)}
            </Badge>
          ) : (
            <Badge variant="neutral">Unavailable</Badge>
          )}
        </div>
        <div className="card-body">
          {loading ? (
            <Skeleton h={32} w="220px" />
          ) : market ? (
            <div className="stack">
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>
                {fmt(market.price)}
              </div>
              <div className="text-sm text-secondary">
                Source: {market.source} | 24h change: {fmtChange(market.change_pct)}
              </div>
            </div>
          ) : (
            <div className="text-sm text-secondary">Market data is not configured.</div>
          )}
        </div>
      </div>


      {/* Top 10 by market cap */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Top 10 Crypto by Market Cap</div>
            <div className="card-subtitle">Live pricing powered by CoinMarketCap</div>
          </div>
          <Badge variant="neutral">Market Data</Badge>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="stack"><Skeleton /><Skeleton /><Skeleton /></div>
          ) : marketTop.length === 0 ? (
            <div className="text-sm text-secondary">Market data is unavailable.</div>
          ) : (
            <div className="data-table-wrapper" style={{ border: "1px solid var(--border-subtle)", borderRadius: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Asset</th>
                    <th className="right">Price</th>
                    <th className="right">24h</th>
                    <th className="right">Market Cap</th>
                    <th className="right">Volume 24h</th>
                  </tr>
                </thead>
                <tbody>
                  {marketTop.map((asset) => (
                    <tr key={asset.symbol}>
                      <td className="text-sm text-secondary">{asset.rank}</td>
                      <td>
                        <div className="stack-sm" style={{ gap: 4 }}>
                          <div className="fw-medium">{asset.name}</div>
                          <div className="text-xs text-secondary">{asset.symbol}</div>
                        </div>
                      </td>
                      <td className="data-table-num">{fmt(asset.price)}</td>
                      <td className="data-table-num">
                        <span className={asset.changePct24h >= 0 ? "text-success" : "text-danger"}>
                          {fmtChange(asset.changePct24h)}
                        </span>
                      </td>
                      <td className="data-table-num">{fmtCompactUsd(asset.marketCap)}</td>
                      <td className="data-table-num">{fmtCompactUsd(asset.volume24h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2-1">
        {/* Cumulative investment chart */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Portfolio Performance</div>
              <div className="card-subtitle">Cumulative capital deployed over time</div>
            </div>
            {totalInvested > 0 && (
              <span className="tag text-success">{fmt(totalInvested)} deployed</span>
            )}
          </div>
          <div className="card-body">
            {loading
              ? <Skeleton h={180} />
              : <AreaChart transactions={txList} height={160} />
            }
          </div>
        </div>

        {/* Pool allocation donut */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Capital Allocation</div>
            <div className="card-subtitle">Treasury pool breakdown</div>
          </div>
          <div className="card-body">
            {loading
              ? <Skeleton h={100} />
              : <PoolDonut investPool={investPool} payrollPool={payrollPool} lendingPool={lendingPool} />
            }
          </div>
        </div>
      </div>

      {/* Investment transaction history */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Investment Transactions</div>
            <div className="card-subtitle">On-chain investment executions by the AI agent</div>
          </div>
          <Badge variant="accent">AI Agent</Badge>
        </div>

        {error ? (
          <div className="card-body"><div className="alert alert-danger">{error}</div></div>
        ) : loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /></div></div>
        ) : txList.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "48px 0" }}>
              <div className="empty-state-title">No investment activity yet</div>
              <div className="empty-state-desc">
                Configure a treasury allocation and click <strong>Run AI Agent</strong> to start investing.
              </div>
              <button className="btn btn-primary" onClick={handleRunAgent} disabled={running}>
                Run AI Agent
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th className="right">Amount Invested</th>
                    <th>Tx Hash</th>
                    <th className="right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {txList.map((tx, i) => (
                    <tr key={tx.id ?? i}>
                      <td className="text-sm text-secondary" style={{ whiteSpace: "nowrap" }}>
                        {new Date(tx.created_at).toLocaleString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="data-table-num">{fmt(tx.amount)}</td>
                      <td>
                        {tx.tx_hash
                          ? <span className="font-mono text-xs text-secondary">{tx.tx_hash.slice(0, 14)}…{tx.tx_hash.slice(-6)}</span>
                          : <span className="text-tertiary text-xs">—</span>}
                      </td>
                      <td className="right">
                        <Badge variant={tx.tx_hash ? "success" : "accent"}>
                          {tx.tx_hash ? "On-chain" : "Executed"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <div className="row-between">
                <span className="text-sm text-secondary">{txList.length} investment executions</span>
                <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Info card if no allocation set */}
      {!loading && !allocation && (
        <div className="alert alert-info">
          <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
          <div>
            <strong>No treasury allocation configured.</strong>
            <div className="text-sm" style={{ marginTop: 4 }}>
              Post to <code>POST /treasury/allocate</code> with <code>{"{ companyId, payrollReserve, lendingPool, investmentPool }"}</code> to enable AI investing.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
