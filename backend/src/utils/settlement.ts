import { env } from "../config/env.js";

export const SUPPORTED_SETTLEMENT_CHAINS = ["ethereum", "polygon"] as const;

export type SettlementChain = (typeof SUPPORTED_SETTLEMENT_CHAINS)[number];

type TokenConfig = {
  symbol: "USDT";
  address: string;
  decimals: number;
  blockchain: SettlementChain;
};

type ContractAddresses = {
  core: string;
  loan: string;
  verifier: string;
};

function parseDecimals(value: string | undefined, fallback = 6) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isSettlementChain(value: string | null | undefined): value is SettlementChain {
  return SUPPORTED_SETTLEMENT_CHAINS.includes((value ?? "").trim().toLowerCase() as SettlementChain);
}

export function normalizeSettlementChain(
  value: string | null | undefined,
  fallback: SettlementChain = "ethereum"
): SettlementChain {
  const normalized = (value ?? "").trim().toLowerCase();
  return isSettlementChain(normalized) ? normalized : fallback;
}

export function getDefaultSettlementChain(): SettlementChain {
  return normalizeSettlementChain(env.DEFAULT_CHAIN, "ethereum");
}

export function getSettlementNetworkLabel(chain: SettlementChain) {
  return chain === "polygon" ? "Polygon" : "Ethereum";
}

export function getSettlementCurrencyLabel(chain: SettlementChain) {
  return `USDT on ${getSettlementNetworkLabel(chain)}`;
}

export function getNativeGasAssetLabel(chain: SettlementChain) {
  return chain === "polygon" ? "native POL" : "native ETH";
}

export function getSettlementTokenConfig(chain: SettlementChain): TokenConfig | null {
  if (chain === "polygon") {
    const address = env.POLYGON_TREASURY_TOKEN_ADDRESS?.trim();
    if (!address) {
      return null;
    }
    return {
      symbol: "USDT",
      address,
      decimals: parseDecimals(env.POLYGON_TREASURY_TOKEN_DECIMALS),
      blockchain: "polygon"
    };
  }

  const address =
    env.ETHEREUM_TREASURY_TOKEN_ADDRESS?.trim() ||
    (normalizeSettlementChain(env.TREASURY_TOKEN_BLOCKCHAIN, "ethereum") === "ethereum"
      ? env.TREASURY_TOKEN_ADDRESS?.trim()
      : undefined);
  if (!address) {
    return null;
  }
  return {
    symbol: "USDT",
    address,
    decimals: parseDecimals(env.ETHEREUM_TREASURY_TOKEN_DECIMALS ?? env.TREASURY_TOKEN_DECIMALS),
    blockchain: "ethereum"
  };
}

export function getSettlementTokenSymbol(chain: SettlementChain) {
  if (chain === "polygon") {
    return getSettlementTokenConfig(chain)?.symbol ?? "POL";
  }
  return getSettlementTokenConfig(chain)?.symbol ?? "ETH";
}

export function getContractAddressesForChain(chain: SettlementChain): ContractAddresses {
  if (chain === "polygon") {
    const core = env.POLYGON_FLOW_PAY_CORE_ADDRESS?.trim();
    const loan = env.POLYGON_FLOW_PAY_LOAN_ADDRESS?.trim();
    const verifier = env.POLYGON_SCORE_TIER_VERIFIER_ADDRESS?.trim();
    if (!core || !loan || !verifier) {
      throw new Error("Polygon FlowPay contract addresses are not fully configured");
    }
    return { core, loan, verifier };
  }

  const core = env.CORE_CONTRACT_ADDRESS?.trim();
  const loan = env.LOAN_CONTRACT_ADDRESS?.trim();
  const verifier = env.SCORE_TIER_VERIFIER_ADDRESS?.trim();
  if (!core || !loan || !verifier) {
    throw new Error("Ethereum FlowPay contract addresses are not fully configured");
  }
  return { core, loan, verifier };
}

export function hasContractAddressesForChain(chain: SettlementChain) {
  try {
    getContractAddressesForChain(chain);
    return true;
  } catch {
    return false;
  }
}
