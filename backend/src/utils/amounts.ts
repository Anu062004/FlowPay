import { formatEther, parseEther, formatUnits, parseUnits } from "ethers";

export function parseAmount(amount: string | number): bigint {
  const normalized = typeof amount === "number" ? amount.toString() : amount;
  return parseEther(normalized);
}

export function formatAmount(wei: bigint): string {
  return formatEther(wei);
}

export function parseTokenAmount(amount: string | number, decimals: number): bigint {
  const normalized = typeof amount === "number" ? amount.toString() : amount;
  return parseUnits(normalized, decimals);
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}
