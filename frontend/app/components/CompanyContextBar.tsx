"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { CompanyContext, loadCompanyContext, saveCompanyContext, clearCompanyContext } from "../lib/companyContext";

export default function CompanyContextBar() {
  const [context, setContext] = useState<CompanyContext | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setContext(loadCompanyContext());
  }, []);

  const refresh = async () => {
    if (!context?.id) return;
    try {
      const data = await apiFetch(`/companies/${context.id}`);
      const next = {
        id: data.id,
        name: data.name,
        treasuryAddress: data.treasury_address ?? null
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
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">Active Company</div>
          <div style={{ fontWeight: 600 }}>{context.name ?? "Unnamed Company"}</div>
          <div className="label">Company ID</div>
          <div style={{ fontSize: 13 }}>{context.id}</div>
          {context.treasuryAddress ? (
            <>
              <div className="label">Treasury Address</div>
              <div style={{ fontSize: 13 }}>{context.treasuryAddress}</div>
            </>
          ) : null}
        </div>
        <div className="stack" style={{ alignItems: "flex-end" }}>
          <button className="secondary" onClick={() => copy(context.id)}>
            Copy Company ID
          </button>
          {context.treasuryAddress ? (
            <button className="secondary" onClick={() => copy(context.treasuryAddress)}>
              Copy Treasury Address
            </button>
          ) : null}
          <button className="secondary" onClick={refresh}>
            Refresh Details
          </button>
          <button onClick={() => {
            clearCompanyContext();
            setContext(null);
          }}>
            Clear Context
          </button>
        </div>
      </div>
      {message ? <div className="label">{message}</div> : null}
    </div>
  );
}
