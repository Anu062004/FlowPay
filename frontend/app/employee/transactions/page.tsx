"use client";
import { useState } from "react";
import type { Transaction } from "../../lib/api";
import { useMyTransactions } from "../../lib/hooks";
import { loadEmployeeContext, type EmployeeContext } from "../../lib/companyContext";
import EmployeeSessionPrompt from "../../components/EmployeeSessionPrompt";
import {
  getTransactionExplorerUrl,
  getTransactionHashFallbackLabel,
  isLedgerRecordedTransaction
} from "../../lib/transactions";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function Badge({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`badge badge-${variant}`}><span className="badge-dot" />{children}</span>;
}

function fmt(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "--";
  const n = parseFloat(String(val));
  return isNaN(n) ? "--" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ETH`;
}

function Skeleton() {
  return <div style={{ height: 18, background: "var(--gray-100)", borderRadius: 4 }} />;
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

const TX_LABEL: Record<string, string> = {
  payroll: "Salary Received",
  loan_disbursement: "Loan Disbursement",
  emi_repayment: "EMI Deduction",
  withdrawal: "Withdrawal",
  deposit: "Deposit",
  investment: "Investment",
};

const TX_BADGE: Record<string, string> = {
  payroll: "success",
  loan_disbursement: "primary",
  emi_repayment: "warning",
  withdrawal: "danger",
  deposit: "success",
  investment: "accent",
};

export default function EmployeeTransactionsPage() {
  const [ctx] = useState<EmployeeContext | null>(() => loadEmployeeContext());
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const { data, loading, error, refetch } = useMyTransactions();
  const txList = data?.transactions ?? [];

  const totalIn = txList
    .filter((t) => t.type === "payroll" || t.type === "loan_disbursement")
    .reduce((s, t) => s + parseFloat(t.amount), 0);
  const totalEmi = txList
    .filter((t) => t.type === "emi_repayment")
    .reduce((s, t) => s + parseFloat(t.amount), 0);

  if (!ctx) {
    return (
      <div className="stack-xl">
        <div className="page-header"><h1 className="page-title">My Transactions</h1></div>
        <EmployeeSessionPrompt />
      </div>
    );
  }

  return (
    <div className="stack-xl">
      <div className="page-header-row">
        <div className="page-header">
          <h1 className="page-title">My Transactions</h1>
          <p className="page-subtitle">Personal transaction history</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>
          <Icon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" size={14} />
          Refresh
        </button>
      </div>

      <div className="grid-3">
        {[
          { label: "Total Received", value: loading ? "--" : fmt(totalIn), sub: "Salary + loan proceeds" },
          { label: "Total EMI Deducted", value: loading ? "--" : fmt(totalEmi), sub: `${txList.filter((t) => t.type === "emi_repayment").length} deductions` },
          { label: "Transactions", value: loading ? "--" : String(txList.length), sub: "All time" },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {loading ? <Skeleton /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
            <div className="metric-card-change neutral">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Transaction History</div>
        </div>
        {error ? (
          <div className="card-body"><div className="alert alert-danger">{error}</div></div>
        ) : loading ? (
          <div className="card-body"><div className="stack"><Skeleton /><Skeleton /><Skeleton /></div></div>
        ) : txList.length === 0 ? (
          <div className="card-body">
            <div className="empty-state" style={{ padding: "40px 0" }}>
              <div className="empty-state-title">No transactions yet</div>
              <div className="empty-state-desc">Transactions will appear once payroll or loans are processed.</div>
            </div>
          </div>
        ) : (
          <>
            <div className="data-table-wrapper" style={{ border: "none", borderRadius: 0 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="right">Amount</th>
                    <th>Tx Hash</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {txList.map((tx, i) => {
                    const isCredit = tx.type === "payroll" || tx.type === "loan_disbursement";
                    return (
                      <tr key={tx.id ?? i}>
                        <td className="text-sm text-secondary" style={{ whiteSpace: "nowrap" }}>
                          {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td>
                          <Badge variant={TX_BADGE[tx.type] ?? "neutral"}>
                            {TX_LABEL[tx.type] ?? tx.type}
                          </Badge>
                        </td>
                        <td className={`data-table-num ${isCredit ? "text-success" : ""}`}>
                          {isCredit ? "+" : "-"}{fmt(tx.amount)}
                        </td>
                        <td>
                          {tx.tx_hash ? (
                            <a
                              href={getTransactionExplorerUrl(tx.tx_hash)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-xs text-secondary"
                              title="Open transaction in explorer"
                            >
                              {tx.tx_hash.slice(0, 12)}...
                            </a>
                          ) : (
                            <span className="text-tertiary text-xs">{getTransactionHashFallbackLabel(tx)}</span>
                          )}
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedTx(tx)}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <span className="text-sm text-secondary">{txList.length} transactions</span>
            </div>
          </>
        )}
      </div>

      {selectedTx ? (
        <div className="modal-backdrop" onClick={() => setSelectedTx(null)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Transaction Details</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setSelectedTx(null)}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Type</span>
                  <Badge variant={TX_BADGE[selectedTx.type] ?? "neutral"}>
                    {TX_LABEL[selectedTx.type] ?? selectedTx.type}
                  </Badge>
                </div>
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Amount</span>
                  <span className="fw-semi font-mono text-sm">{fmt(selectedTx.amount)}</span>
                </div>
                <div className="row-between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <span className="text-sm text-secondary">Date</span>
                  <span className="fw-semi text-sm">
                    {new Date(selectedTx.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit"
                    })}
                  </span>
                </div>
                <div style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
                  <div className="text-sm text-secondary" style={{ marginBottom: 8 }}>FlowPay Transaction ID</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="font-mono text-xs text-secondary" style={{ wordBreak: "break-all" }}>{selectedTx.id}</span>
                    <CopyButton text={selectedTx.id} />
                  </div>
                </div>
                <div>
                  <div className="text-sm text-secondary" style={{ marginBottom: 8 }}>Blockchain Tx Hash</div>
                  {selectedTx.tx_hash ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <a
                        href={getTransactionExplorerUrl(selectedTx.tx_hash)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-secondary"
                        style={{ wordBreak: "break-all" }}
                        title="Open transaction in explorer"
                      >
                        {selectedTx.tx_hash}
                      </a>
                      <CopyButton text={selectedTx.tx_hash} />
                    </div>
                  ) : isLedgerRecordedTransaction(selectedTx) ? (
                    <span className="text-sm text-tertiary">
                      This EMI deduction was recorded as part of payroll netting, so there is no separate blockchain hash.
                    </span>
                  ) : (
                    <span className="text-sm text-tertiary">
                      No on-chain hash has been recorded for this entry yet.
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedTx(null)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
