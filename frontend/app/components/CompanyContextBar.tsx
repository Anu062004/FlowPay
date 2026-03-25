"use client";

import { useEffect, useState } from "react";
import { apiFetch, type Company } from "../lib/api";
import { CompanyContext, clearCompanyContext, loadCompanyContext, saveCompanyContext } from "../lib/companyContext";
import { getSettlementNetworkLabel, normalizeSettlementChain } from "../lib/settlement";

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="company-context-item">
      <div className="company-context-label">{label}</div>
      <div className="company-context-value">{value}</div>
    </div>
  );
}

export default function CompanyContextBar() {
  const [context, setContext] = useState<CompanyContext | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setContext(loadCompanyContext());
  }, []);

  const refresh = async () => {
    if (!context?.id) return;
    try {
      const data = await apiFetch<Company>(`/companies/${context.id}`);
      const next = {
        id: data.id,
        name: data.name,
        email: data.email,
        treasuryAddress: data.treasury_address ?? null,
        treasuryChain: data.treasury_chain ?? null
      } as CompanyContext;
      saveCompanyContext(next);
      setContext(next);
      setMessage("Company context refreshed");
    } catch {
      setMessage("Failed to refresh company context");
    }
  };

  const copy = async (value?: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setMessage("Copied to clipboard");
  };

  if (!context?.id) {
    return null;
  }

  return (
    <section className="card company-context-card">
      <div className="company-context-header">
        <div className="company-context-heading">
          <span className="company-context-kicker">Workspace Context</span>
          <div className="company-context-title">{context.name ?? "Unnamed Company"}</div>
          <div className="company-context-subtitle">
            Context used across routing, treasury actions, payroll execution, and workspace restore.
          </div>
        </div>
        <div className="company-context-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => copy(context.id)}>
            Copy Company ID
          </button>
          {context.treasuryAddress ? (
            <button className="btn btn-secondary btn-sm" onClick={() => copy(context.treasuryAddress)}>
              Copy Treasury Address
            </button>
          ) : null}
          <button className="btn btn-secondary btn-sm" onClick={refresh}>
            Refresh Details
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              clearCompanyContext();
              setContext(null);
            }}
          >
            Clear Context
          </button>
        </div>
      </div>

      <div className="company-context-grid">
        {context.email ? <ContextItem label="Company Email" value={context.email} /> : null}
        <ContextItem label="Company ID" value={context.id} />
        {context.treasuryChain ? (
          <ContextItem
            label="Settlement Network"
            value={getSettlementNetworkLabel(normalizeSettlementChain(context.treasuryChain))}
          />
        ) : null}
        {context.treasuryAddress ? <ContextItem label="Treasury Address" value={context.treasuryAddress} /> : null}
      </div>

      {message ? <div className="company-context-feedback">{message}</div> : null}
    </section>
  );
}
