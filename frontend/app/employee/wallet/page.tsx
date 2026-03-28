"use client";
import { useEffect, useMemo, useState } from "react";
import { useEmployeeWallet, useMyTransactions } from "../../lib/hooks";
import { withdrawEmployeeFunds, type WalletWithdrawalAsset, type WalletWithdrawalOption } from "../../lib/api";
import { loadEmployeeContext, type EmployeeContext } from "../../lib/companyContext";
import EmployeeSessionPrompt from "../../components/EmployeeSessionPrompt";
import {
  getSettlementNativeGasLabel,
  getSettlementNetworkLabel,
  normalizeSettlementChain
} from "../../lib/settlement";

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function fmtAmount(val: string | number | null | undefined, symbol = "USDT"): string {
  if (val === null || val === undefined) return "--";
  const n = parseFloat(String(val));
  return isNaN(n) ? "--" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${symbol}`;
}

function Skeleton({ h = 20 }: { h?: number }) {
  return <div style={{ height: h, background: "var(--gray-100)", borderRadius: 4 }} />;
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

function isEvmAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export default function EmployeeWalletPage() {
  const [ctx] = useState<EmployeeContext | null>(() => loadEmployeeContext());
  const [step, setStep] = useState<"idle" | "enter" | "confirm">("idle");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<WalletWithdrawalAsset>("settlement");
  const [submitting, setSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const txHook = useMyTransactions();
  const walletHook = useEmployeeWallet(ctx?.id ?? null);

  const txList = txHook.data?.transactions ?? [];
  const totalSalary = txList
    .filter((t) => t.type === "payroll")
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
  const totalLoanProceeds = txList
    .filter((t) => t.type === "loan_disbursement")
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
  const totalOutflows = txList
    .filter((t) => t.type === "emi_repayment" || t.type === "withdrawal")
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  const lastSalary = txList.find((t) => t.type === "payroll");
  const walletAddress = walletHook.data?.wallet_address ?? null;
  const walletChain = normalizeSettlementChain(walletHook.data?.chain, "ethereum");
  const walletNetworkLabel = getSettlementNetworkLabel(walletChain);
  const walletGasLabel = getSettlementNativeGasLabel(walletChain);
  const balance = parseFloat(walletHook.data?.balance ?? "0");
  const tokenSymbol = walletHook.data?.token_symbol ?? "USDT";
  const withdrawalOptions = useMemo<WalletWithdrawalOption[]>(() => {
    if (walletHook.data?.withdrawal_options?.length) {
      return walletHook.data.withdrawal_options;
    }
    return [
      {
        asset: "settlement",
        symbol: tokenSymbol,
        balance: walletHook.data?.balance ?? "0",
        max_withdrawable: walletHook.data?.max_withdrawable ?? "0"
      }
    ];
  }, [
    tokenSymbol,
    walletHook.data?.balance,
    walletHook.data?.max_withdrawable,
    walletHook.data?.withdrawal_options
  ]);
  const selectedOption =
    withdrawalOptions.find((option) => option.asset === selectedAsset) ?? withdrawalOptions[0] ?? null;
  const selectedSymbol = selectedOption?.symbol ?? tokenSymbol;
  const selectedBalance = parseFloat(selectedOption?.balance ?? walletHook.data?.balance ?? "0");
  const maxWithdrawable = parseFloat(selectedOption?.max_withdrawable ?? walletHook.data?.max_withdrawable ?? "0");
  const hasWithdrawableOption = withdrawalOptions.some((option) => parseFloat(option.max_withdrawable ?? "0") > 0);
  const nativeOption = withdrawalOptions.find((option) => option.asset === "native") ?? null;

  const trimmedDest = dest.trim();
  const numericAmount = parseFloat(amount);
  const canContinue = useMemo(() => {
    return (
      Boolean(walletAddress) &&
      isEvmAddress(trimmedDest) &&
      Number.isFinite(numericAmount) &&
      numericAmount > 0 &&
      numericAmount <= maxWithdrawable
    );
  }, [maxWithdrawable, numericAmount, trimmedDest, walletAddress]);

  useEffect(() => {
    if (!withdrawalOptions.length) {
      return;
    }
    if (!withdrawalOptions.some((option) => option.asset === selectedAsset)) {
      setSelectedAsset(withdrawalOptions[0].asset);
    }
  }, [selectedAsset, withdrawalOptions]);

  async function handleContinue() {
    if (!isEvmAddress(trimmedDest)) {
      setActionError("Enter a valid wallet address.");
      return;
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setActionError("Enter a valid withdrawal amount.");
      return;
    }
    if (numericAmount > maxWithdrawable) {
      setActionError(`Amount exceeds your max withdrawable balance of ${fmtAmount(maxWithdrawable, selectedSymbol)}.`);
      return;
    }
    setActionError(null);
    setStep("confirm");
  }

  async function handleConfirmWithdrawal() {
    if (!ctx?.id) {
      return;
    }

    setSubmitting(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const result = await withdrawEmployeeFunds(ctx.id, {
        destinationAddress: trimmedDest,
        amount: numericAmount,
        asset: selectedOption?.asset
      });
      setActionMessage(
        `Withdrawal submitted. Sent ${fmtAmount(result.amount, result.token_symbol ?? selectedSymbol)} to ${result.to.slice(0, 10)}...${result.to.slice(-6)}${result.txHash ? ` (tx ${result.txHash.slice(0, 12)}...).` : "."}`
      );
      setDest("");
      setAmount("");
      setStep("idle");
      await Promise.all([walletHook.refetch(), txHook.refetch()]);
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to withdraw funds.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ctx) {
    return (
      <div className="stack-xl">
        <div className="page-header"><h1 className="page-title">My Wallet</h1></div>
        <EmployeeSessionPrompt />
      </div>
    );
  }

  return (
    <div className="stack-xl">
      <div className="page-header">
        <h1 className="page-title">My Wallet</h1>
        <p className="page-subtitle">Personal {walletNetworkLabel} wallet{ctx.fullName ? ` · ${ctx.fullName}` : ""}</p>
      </div>

      {actionMessage ? (
        <div className="alert alert-success">
          <span className="alert-icon"><Icon d="M5 13l4 4L19 7" size={16} /></span>
          <span>{actionMessage}</span>
        </div>
      ) : null}
      {actionError ? (
        <div className="alert alert-danger">
          <span className="alert-icon"><Icon d="M6 18L18 6M6 6l12 12" size={16} /></span>
          <span>{actionError}</span>
        </div>
      ) : null}
      {walletHook.error ? (
        <div className="alert alert-danger">{walletHook.error}</div>
      ) : null}

      <div className="wallet-card">
        <div className="wallet-card-label">Personal Wallet · {walletNetworkLabel}</div>
        {walletHook.loading ? (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 32, fontWeight: 700 }}>Loading…</div>
        ) : (
          <div className="wallet-card-balance">{fmtAmount(walletHook.data?.balance, tokenSymbol)}</div>
        )}
        <div className="wallet-card-sub">
          {walletAddress ? (
            <span className="font-mono" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {walletAddress.slice(0, 10)}...{walletAddress.slice(-8)}
              <CopyButton text={walletAddress} />
            </span>
          ) : "Wallet address unavailable"}
        </div>
        {nativeOption && nativeOption.symbol !== tokenSymbol ? (
          <div className="wallet-card-sub">Native available: {fmtAmount(nativeOption.balance, nativeOption.symbol)}</div>
        ) : null}
        <div className="wallet-card-actions">
          <button
            className="btn btn-accent"
            style={{ fontSize: 12, padding: "6px 14px" }}
            onClick={() => {
              setActionError(null);
              setStep("enter");
            }}
            disabled={walletHook.loading || !walletAddress || !hasWithdrawableOption}
          >
            Withdraw
          </button>
        </div>
      </div>

      <div className="grid-3">
        {[
          { label: "Wallet Balance", value: walletHook.loading ? "--" : fmtAmount(balance, tokenSymbol), sub: "Live on-chain balance" },
          { label: "Max Withdrawable", value: walletHook.loading ? "--" : fmtAmount(maxWithdrawable, tokenSymbol), sub: "Gas reserve kept aside" },
          { label: "Last Salary", value: txHook.loading ? "--" : (lastSalary ? fmtAmount(lastSalary.amount, lastSalary.token_symbol ?? tokenSymbol) : "--"), sub: "Most recent payroll credit" },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {walletHook.loading || txHook.loading ? <Skeleton h={28} /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
            <div className="metric-card-change neutral">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid-3">
        {[
          { label: "Salary Received", value: txHook.loading ? "--" : fmtAmount(totalSalary, tokenSymbol) },
          { label: "Loan Proceeds", value: txHook.loading ? "--" : fmtAmount(totalLoanProceeds, tokenSymbol) },
          { label: "Total Outflows", value: txHook.loading ? "--" : fmtAmount(totalOutflows, tokenSymbol) },
        ].map((s, i) => (
          <div key={i} className="metric-card">
            <div className="metric-card-label">{s.label}</div>
            {txHook.loading ? <Skeleton h={28} /> : (
              <div className="metric-card-value font-num" style={{ fontSize: "var(--text-3xl)" }}>{s.value}</div>
            )}
          </div>
        ))}
      </div>

      {step === "enter" && (
        <div className="modal-backdrop" onClick={() => setStep("idle")}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Withdraw Funds</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setStep("idle")} disabled={submitting}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                <div className="form-group">
                  <label className="form-label">Asset</label>
                  <select
                    className="form-select"
                    value={selectedOption?.asset ?? "settlement"}
                    onChange={e => setSelectedAsset(e.target.value as WalletWithdrawalAsset)}
                  >
                    {withdrawalOptions.map((option) => (
                      <option key={option.asset} value={option.asset}>
                        {option.symbol} · Balance {fmtAmount(option.balance, option.symbol)}
                      </option>
                    ))}
                  </select>
                  <span className="form-hint">
                    Choose whether to withdraw your settlement balance or native {walletGasLabel}.
                  </span>
                </div>
                <div className="form-group">
                  <label className="form-label">Destination Wallet Address</label>
                  <input
                    className="form-input font-mono"
                    placeholder="0x..."
                    value={dest}
                    onChange={e => setDest(e.target.value)}
                  />
                  <span className="form-hint">Must be a valid EVM wallet address.</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount ({selectedSymbol})</label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.000001"
                    placeholder="0.005000"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                  />
                  <span className="form-hint">
                    Available to send: {fmtAmount(maxWithdrawable, selectedSymbol)}.
                    {selectedOption?.asset === "native"
                      ? ` A small amount stays reserved for ${walletGasLabel}.`
                      : ` Network gas will still be paid in ${walletGasLabel}.`}
                  </span>
                </div>
                <div className="alert alert-warning">
                  <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                  <span>Withdrawals are irreversible. Always double-check the destination address.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setStep("idle")} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary" onClick={handleContinue} disabled={!walletAddress || submitting}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="modal-backdrop" onClick={() => !submitting && setStep("idle")}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Confirm Withdrawal</div>
              <button className="btn btn-ghost btn-icon" onClick={() => setStep("idle")} disabled={submitting}>
                <Icon d="M6 18L18 6M6 6l12 12" size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="stack">
                {[
                  ["Asset", selectedSymbol],
                  ["Amount", fmtAmount(numericAmount, selectedSymbol)],
                  ["Wallet Balance", fmtAmount(selectedBalance, selectedSymbol)],
                  ["Max Withdrawable", fmtAmount(maxWithdrawable, selectedSymbol)],
                  ["To", `${trimmedDest.slice(0, 12)}...${trimmedDest.slice(-8)}`],
                ].map(([k, v], i) => (
                  <div key={i} className="row-between" style={{
                    padding: "10px 0", borderBottom: i < 4 ? "1px solid var(--border-subtle)" : "none"
                  }}>
                    <span className="text-sm text-secondary">{k}</span>
                    <span className="fw-semi font-mono text-sm">{v}</span>
                  </div>
                ))}
                <div className="alert alert-warning">
                  <span className="alert-icon"><Icon d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" size={16} /></span>
                  <span>Network gas is paid separately from your wallet balance. If the balance changes, the transfer may fail.</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setStep("enter")} disabled={submitting}>Back</button>
              <button className="btn btn-danger" onClick={handleConfirmWithdrawal} disabled={!canContinue || submitting}>
                {submitting ? "Submitting..." : "Confirm Withdrawal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
