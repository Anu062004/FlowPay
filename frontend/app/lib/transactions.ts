import type { Transaction } from "./api";

type TransactionLike = Pick<Transaction, "type" | "tx_hash">;

export type TransactionSettlementKind = "confirmed" | "recorded" | "pending";

const DEFAULT_TX_EXPLORER_BASE_URL = "https://sepolia.etherscan.io/tx";

export function getTransactionExplorerUrl(txHash: string) {
  const baseUrl =
    process.env.NEXT_PUBLIC_TX_EXPLORER_BASE_URL ?? DEFAULT_TX_EXPLORER_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/${txHash}`;
}

export function getTransactionSettlementKind(
  transaction: TransactionLike
): TransactionSettlementKind {
  if (transaction.tx_hash) {
    return "confirmed";
  }

  if (transaction.type === "emi_repayment") {
    return "recorded";
  }

  return "pending";
}

export function getTransactionSettlementLabel(transaction: TransactionLike) {
  const settlement = getTransactionSettlementKind(transaction);
  if (settlement === "confirmed") {
    return "Confirmed";
  }
  if (settlement === "recorded") {
    return "Recorded";
  }
  return "Pending";
}

export function getTransactionSettlementVariant(transaction: TransactionLike) {
  const settlement = getTransactionSettlementKind(transaction);
  if (settlement === "confirmed") {
    return "success";
  }
  if (settlement === "recorded") {
    return "info";
  }
  return "warning";
}

export function getTransactionHashFallbackLabel(transaction: TransactionLike) {
  const settlement = getTransactionSettlementKind(transaction);
  if (settlement === "recorded") {
    return "Payroll netting";
  }
  return "Awaiting hash";
}

export function isLedgerRecordedTransaction(transaction: TransactionLike) {
  return getTransactionSettlementKind(transaction) === "recorded";
}
