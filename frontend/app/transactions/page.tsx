"use client";
import { useState } from "react";
import TransactionHashCell from "../components/TransactionHashCell";
import { formatEth } from "../lib/format";
import { useTransactions } from "../lib/hooks";
import {
  getTransactionHashFallbackLabel,
  getTransactionSettlementKind,
  getTransactionSettlementLabel,
  getTransactionSettlementVariant
} from "../lib/transactions";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function fmt(val: string | number | null | undefined, symbol?: string): string {
  return formatEth(val, 6, symbol ?? "ETH");
}

function Skeleton() {
  return <div style={{ height: 18, background: "var(--gray-100)", borderRadius: 4 }} />;
}

const TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  payroll: "Payroll",
  loan_disbursement: "Loan Disbursement",
  emi_repayment: "EMI Repayment",
  investment: "Investment",
  treasury_allocation: "Treasury Allocation",
};
const TYPE_BADGE: Record<string, string> = {
  deposit: "success", payroll: "primary", loan_disbursement: "warning",
  emi_repayment: "info", investment: "accent", treasury_allocation: "neutral",
};

export default function TransactionsPage() {
  const { data, loading, error, refetch } = useTransactions(50);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const txList = data?.transactions ?? [];

  const filtered = txList.filter(tx => {
    const label = TYPE_LABEL[tx.type] ?? tx.type;
    const matchSearch = !search || label.toLowerCase().includes(search.toLowerCase()) ||
      (tx.tx_hash ?? "").toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || tx.type === typeFilter;
    return matchSearch && matchType;
  });

  // Summary KPIs
  const totalVolume = txList.reduce((s, t) => s + parseFloat(t.amount), 0);
  const volumeSymbol = txList.find(t => t.token_symbol)?.token_symbol ?? "ETH";
  const confirmed = txList.filter(t => getTransactionSettlementKind(t) === "confirmed").length;
  const awaitingHash = txList.filter(t => getTransactionSettlementKind(t) === "pending").length;

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">Transactions</h1>
          <p className="page-subtitle">Full treasury ledger · All accounts</p>
        </div>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={refetch}>
            <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid-4">
        {[
          { label: "Total Transactions", value: loading ? "—" : String(data?.total ?? txList.length) },
          { label: "On-chain Confirmed", value: loading ? "—" : String(confirmed) },
          { label: "Awaiting Hash",  value: loading ? "—" : String(awaitingHash) },
          { label: `Total Volume (${volumeSymbol})`, value: loading ? "—" : fmt(totalVolume, volumeSymbol) },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {loading ? <Skeleton /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Transaction Ledger</div>
          <div className="filter-bar">
            <div className="search-input-wrap">
              <span className="search-input-icon"><Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={14} /></span>
              <input className="search-input" placeholder="Search type or hash…"
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

        {error ? (
          <div className="card-body"><div className="alert alert-danger">{error}</div></div>
        ) : loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /><Skeleton /></div></div>
        ) : filtered.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "48px 0" }}>
              <div className="empty-state-title">{txList.length === 0 ? "No transactions yet" : "No results"}</div>
              <div className="empty-state-desc">
                {txList.length === 0
                  ? "Transactions will appear once the treasury is funded."
                  : "Try adjusting your filters."}
              </div>
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
                    <th className="right">Amount</th>
                    <th>Tx Hash</th>
                    <th className="right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx, i) => (
                    <tr key={tx.id ?? i}>
                      <td className="text-sm text-secondary" style={{ whiteSpace: "nowrap" }}>
                        {new Date(tx.created_at).toLocaleString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td>
                        <Badge variant={TYPE_BADGE[tx.type] ?? "neutral"}>
                          {TYPE_LABEL[tx.type] ?? tx.type}
                        </Badge>
                      </td>
                      <td className="data-table-num">{fmt(tx.amount, tx.token_symbol ?? "ETH")}</td>
                      <td>
                        <TransactionHashCell
                          txHash={tx.tx_hash}
                          fallbackLabel={getTransactionHashFallbackLabel(tx)}
                          leadingChars={14}
                        />
                      </td>
                      <td className="right">
                        <Badge variant={getTransactionSettlementVariant(tx)}>
                          {getTransactionSettlementLabel(tx)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <div className="row-between">
                <span className="text-sm text-secondary">
                  {filtered.length} of {data?.total ?? txList.length} transactions
                </span>
                <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


