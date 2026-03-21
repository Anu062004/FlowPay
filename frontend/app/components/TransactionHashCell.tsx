"use client";

import { useState } from "react";
import { getTransactionExplorerUrl } from "../lib/transactions";

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="wallet-address-copy"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }}
      title={copied ? "Copied" : "Copy transaction hash"}
      aria-label={copied ? "Copied transaction hash" : "Copy transaction hash"}
    >
      <Icon
        d={
          copied
            ? "M5 13l4 4L19 7"
            : "M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        }
        size={14}
      />
    </button>
  );
}

function formatShortHash(txHash: string, leadingChars = 12, trailingChars = 6) {
  return `${txHash.slice(0, leadingChars)}...${txHash.slice(-trailingChars)}`;
}

type TransactionHashCellProps = {
  txHash?: string | null;
  fallbackLabel?: string;
  leadingChars?: number;
  trailingChars?: number;
};

export default function TransactionHashCell({
  txHash,
  fallbackLabel = "Awaiting hash",
  leadingChars = 12,
  trailingChars = 6,
}: TransactionHashCellProps) {
  if (!txHash) {
    return <span className="text-tertiary text-xs">{fallbackLabel}</span>;
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className="font-mono text-xs text-secondary" title={txHash}>
        {formatShortHash(txHash, leadingChars, trailingChars)}
      </span>
      <a
        href={getTransactionExplorerUrl(txHash)}
        target="_blank"
        rel="noreferrer"
        className="btn btn-ghost btn-sm"
        style={{ padding: "4px 10px", height: "auto", minHeight: 0 }}
        title="Open transaction in explorer"
      >
        View
      </a>
      <CopyButton text={txHash} />
    </div>
  );
}
