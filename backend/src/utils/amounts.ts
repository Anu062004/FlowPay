import { formatEther, parseEther } from "ethers";

export function parseAmount(amount: string | number): bigint {
  const normalized = typeof amount === "number" ? amount.toString() : amount;
  return parseEther(normalized);
}

export function formatAmount(wei: bigint): string {
  return formatEther(wei);
}
