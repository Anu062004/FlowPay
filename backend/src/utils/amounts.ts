import { formatEther, parseEther, formatUnits, parseUnits } from "ethers";

function normalizeDecimalInput(amount: string | number, decimals: number) {
  const raw = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!raw) {
    return "0";
  }

  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePartRaw, fractionPartRaw = ""] = unsigned.split(".");
  const wholePart = wholePartRaw || "0";
  const fractionPart = fractionPartRaw.slice(0, decimals);
  const normalized = fractionPart ? `${wholePart}.${fractionPart}` : wholePart;

  return negative ? `-${normalized}` : normalized;
}

export function parseAmount(amount: string | number): bigint {
  const normalized = normalizeDecimalInput(amount, 18);
  return parseEther(normalized);
}

export function formatAmount(wei: bigint): string {
  return formatEther(wei);
}

export function parseTokenAmount(amount: string | number, decimals: number): bigint {
  const normalized = normalizeDecimalInput(amount, decimals);
  return parseUnits(normalized, decimals);
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}
