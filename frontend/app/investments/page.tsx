"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { loadCompanyContext } from "../lib/companyContext";

type InvestmentPosition = {
  id: string;
  protocol: string;
  amount_deposited: string;
  atoken_balance: string;
  yield_earned: string;
  status: "active" | "closed" | "liquidated";
  opened_at: string;
  closed_at: string | null;
};

type InvestmentResponse = {
  positions?: InvestmentPosition[];
  transactions?: { id: string; amount: string; created_at: string }[];
};

function fmtEth(value: string | number): string {
  const parsed = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return "0.000000 ETH";
  }
  return `${parsed.toFixed(6)} ETH`;
}

function fmtDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function InvestmentsPage() {
  const [positions, setPositions] = useState<InvestmentPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const company = loadCompanyContext();
    if (!company?.id) {
      setLoading(false);
      return;
    }

    apiFetch<InvestmentResponse>(`/investments?companyId=${company.id}`)
      .then((data) => {
        if (data.positions && data.positions.length > 0) {
          setPositions(data.positions);
          return;
        }

        // Backward-compatible fallback if backend has not exposed positions yet.
        const fallback = (data.transactions ?? []).map((tx) => ({
          id: tx.id,
          protocol: "aave-v3-sepolia",
          amount_deposited: tx.amount,
          atoken_balance: tx.amount,
          yield_earned: "0",
          status: "closed" as const,
          opened_at: tx.created_at,
          closed_at: tx.created_at
        }));
        setPositions(fallback);
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const summary = useMemo(() => {
    const totalDeployed = positions.reduce((sum, item) => sum + parseFloat(item.amount_deposited), 0);
    const totalYield = positions.reduce((sum, item) => sum + parseFloat(item.yield_earned), 0);
    const activePositions = positions.filter((item) => item.status === "active").length;
    return { totalDeployed, totalYield, activePositions };
  }, [positions]);

  return (
    <div className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">Investments</h1>
        <p className="page-subtitle">Aave v3 Sepolia deployment and performance tracking</p>
      </div>

      <div className="grid-3">
        <div className="metric-card">
          <div className="metric-card-label">Total Deployed</div>
          <div className="metric-card-value font-num">{fmtEth(summary.totalDeployed)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Total Yield</div>
          <div className="metric-card-value font-num">{fmtEth(summary.totalYield)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Active Positions</div>
          <div className="metric-card-value font-num">{summary.activePositions}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Investment Positions</div>
        </div>
        <div className="card-body">
          {loading ? (
            <div className="text-sm text-secondary">Loading positions...</div>
          ) : error ? (
            <div className="alert alert-danger">{error}</div>
          ) : positions.length === 0 ? (
            <div className="text-sm text-secondary">No investment positions found.</div>
          ) : (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Protocol</th>
                    <th className="right">Amount Deposited</th>
                    <th className="right">Current aToken Balance</th>
                    <th className="right">Yield Earned</th>
                    <th>Status</th>
                    <th>Opened At</th>
                    <th>Closed At</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.id}>
                      <td>{position.protocol}</td>
                      <td className="data-table-num">{fmtEth(position.amount_deposited)}</td>
                      <td className="data-table-num">{fmtEth(position.atoken_balance)}</td>
                      <td className="data-table-num">{fmtEth(position.yield_earned)}</td>
                      <td>
                        <span className={`badge badge-${position.status === "active" ? "success" : "neutral"}`}>
                          <span className="badge-dot" />
                          {position.status}
                        </span>
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
      </div>
    </div>
  );
}
