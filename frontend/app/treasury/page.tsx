"use client";
import { useEffect, useState } from "react";
import { formatEth } from "../lib/format";
import { useTreasuryBalance, useTransactions } from "../lib/hooks";
import { loadCompanyContext, type CompanyContext } from "../lib/companyContext";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function fmt(val: string | number | null | undefined): string {
  return formatEth(val);
}

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function Skeleton({ h = 20, w = "100%" }: { h?: number; w?: string }) {
  return <div style={{ width: w, height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="wallet-address-copy" onClick={() => {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }}>
      <Icon d={copied ? "M5 13l4 4L19 7" : "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"} size={14} />
    </button>
  );
}

const TX_TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  payroll: "Payroll Disbursement",
  loan_disbursement: "Loan Disbursement",
  emi_repayment: "EMI Repayment",
  investment: "Investment",
  treasury_allocation: "Treasury Allocation",
};
const TX_BADGE: Record<string, string> = {
  deposit: "success", payroll: "primary", loan_disbursement: "warning",
  emi_repayment: "info", investment: "accent", treasury_allocation: "neutral",
};

export default function TreasuryPage() {
  const treasury = useTreasuryBalance();
  const txData = useTransactions(20);
  const [showDeposit, setShowDeposit] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ctx, setCtx] = useState<CompanyContext | null>(null);

  useEffect(() => {
    setCtx(loadCompanyContext());
  }, []);
  const walletAddress = ctx?.treasuryAddress ?? treasury.data?.wallet_address ?? null;
  const balance = parseFloat(treasury.data?.balance ?? "0");

  const allTx = txData.data?.transactions ?? [];
  const filteredTx = allTx.filter(tx => {
    const matchType = typeFilter === "all" || tx.type === typeFilter;
    const label = TX_TYPE_LABELS[tx.type] ?? tx.type;
    const matchSearch = !search || label.toLowerCase().includes(search.toLowerCase()) ||
      (tx.tx_hash ?? "").toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Treasury</h1>
          <p className="page-subtitle">Company treasury wallet and on-chain reserves</p>
        </div>
        <div className="row">
          <button className="btn btn-secondary" onClick={() => setShowDeposit(true)}>
            Deposit Instructions
          </button>
        </div>
      </div>

      {/* Wallet card */}
      <div className="wallet-card">
        <div className="wallet-card-label">Treasury Wallet · Aleo Mainnet</div>
        {treasury.loading ? (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 32, fontWeight: 700 }}>Loading…</div>
        ) : (
          <div className="wallet-card-balance">{fmt(balance)}</div>
        )}
        <div className="wallet-card-sub">Live on-chain balance</div>
        <div className="wallet-card-actions">
          <button className="btn btn-secondary" style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => setShowDeposit(true)}>
            Deposit
          </button>
          <button className="btn btn-ghost" style={{ color: "rgba(255,255,255,0.55)", fontSize: 12,
            padding: "6px 14px", borderColor: "rgba(255,255,255,0.12)" }}
            onClick={() => { treasury.refetch(); txData.refetch(); }}>
            <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={13} />
            Refresh
          </button>
        </div>
        {walletAddress && (
          <div className="wallet-card-addr">
            <span style={{ opacity: 0.5 }}>Address:</span>
            <span>{walletAddress.slice(0, 22)}…{walletAddress.slice(-8)}</span>
            <CopyButton text={walletAddress} />
          </div>
        )}
      </div>

      {/* Full address */}
      {walletAddress && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Wallet Address</div>
              <div className="card-subtitle">Use this address to receive funds on Aleo Mainnet</div>
            </div>
            <Badge variant="success">Active</Badge>
          </div>
          <div className="card-body">
            <div className="wallet-address" style={{ maxWidth: "100%", padding: "12px 16px" }}>
              <span className="wallet-address-text" style={{ userSelect: "all" }}>{walletAddress}</span>
              <CopyButton text={walletAddress} />
            </div>
            <div className="alert alert-info mt-4" style={{ marginTop: 16 }}>
              <span className="alert-icon"><Icon d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" size={16} /></span>
              <span>Only send USDC or native ALEO tokens to this address. Sending other assets may result in permanent loss of funds.</span>
            </div>
          </div>
        </div>
      )}

      {/* Transaction history */}
      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Transaction History</div>
            <div className="card-subtitle">All treasury inflows and outflows</div>
          </div>
          <div className="filter-bar">
            <div className="search-input-wrap">
              <span className="search-input-icon"><Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={14} /></span>
              <input className="search-input" placeholder="Search transactions…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="form-select" style={{ width: "auto", fontSize: 13 }}
              value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              <option value="deposit">Deposit</option>
              <option value="payroll">Payroll</option>
              <option value="investment">Investment</option>
              <option value="loan_disbursement">Loan Disbursement</option>
              <option value="emi_repayment">EMI Repayment</option>
            </select>
          </div>
        </div>

        {txData.loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /></div></div>
        ) : txData.error ? (
          <div className="card-body"><div className="alert alert-danger">{txData.error}</div></div>
        ) : filteredTx.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "40px 0" }}>
              <div className="empty-state-title">No transactions found</div>
              <div className="empty-state-desc">Fund your treasury to see transaction history here.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Type</th>
                    <th className="right">Amount (USD)</th>
                    <th>Tx Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTx.map((tx, i) => (
                    <tr key={tx.id ?? i}>
                      <td className="text-sm text-secondary" style={{ whiteSpace: "nowrap" }}>
                        {new Date(tx.created_at).toLocaleString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                          hour: "2-digit", minute: "2-digit"
                        })}
                      </td>
                      <td><Badge variant={TX_BADGE[tx.type] ?? "neutral"}>{TX_TYPE_LABELS[tx.type] ?? tx.type}</Badge></td>
                      <td className="data-table-num">{fmt(tx.amount)}</td>
                      <td>
                        {tx.tx_hash
                          ? <span className="font-mono text-xs text-secondary">{tx.tx_hash.slice(0, 12)}…{tx.tx_hash.slice(-6)}</span>
                          : <span className="text-tertiary text-xs">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <div className="row-between">
                <span className="text-sm text-secondary">
                  Showing {filteredTx.length} of {txData.data?.total ?? filteredTx.length} transactions
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => txData.refetch()}>Refresh</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Deposit modal */}
      {showDeposit && walletAddress && (
        <div className="modal-backdrop" onClick={() => setShowDeposit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Deposit Instructions</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowDeposit(false)}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                <div className="form-group">
                  <label className="form-label">Treasury Wallet Address</label>
                  <div className="wallet-address" style={{ maxWidth: "100%" }}>
                    <span className="wallet-address-text">{walletAddress}</span>
                    <CopyButton text={walletAddress} />
                  </div>
                </div>
                <div className="alert alert-warning">
                  <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                  <span>Transfers on Aleo network take 1–3 minutes to confirm.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeposit(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

