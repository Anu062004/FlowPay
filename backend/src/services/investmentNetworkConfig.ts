import { env } from "../config/env.js";
import type { SettlementChain } from "../utils/settlement.js";
import { getSettlementTokenConfig } from "../utils/settlement.js";

type AssetConfig = {
  address: string;
  symbol: string;
  decimals: number;
};

type StableSwapConfig = {
  routerAddress: string;
  quoterAddress: string;
  poolFee: number;
  slippageBps: number;
};

type TradingAgentsConfig = {
  url: string;
  secret: string;
  timeoutMs: number;
};

type ProtocolAddressMap = {
  yearnVaultAddress: string | null;
  aavePoolAddress: string | null;
  compoundCometAddress: string | null;
  morphoVaultAddress: string | null;
  beefyVaultAddress: string | null;
  fluidVaultAddress: string | null;
  pendleRouterAddress: string | null;
  pendleMarketAddress: string | null;
  pendleSyAddress: string | null;
};

const PROTOCOL_KEY_ALIASES: Record<string, string> = {
  aave_v3_usdc: "aave_usdc",
  compound_v3_usdc: "compound_v3_usdc",
  morpho_v1_usdc: "morpho_v1_usdc",
  beefy_usdc: "beefy_usdc",
  fluid_lending_usdc: "fluid_lending_usdc",
  yearn_v3_usdc: "yearn_usdc",
  pendle_pt_usdc: "pendle_pt_usdc"
};

function prefixedName(chain: SettlementChain, name: string) {
  return `${chain.toUpperCase()}_${name}`;
}

function envValue(
  chain: SettlementChain,
  name: string,
  fallback?: string | null,
  allowGlobalFallback = chain === "ethereum"
) {
  const chainSpecific = process.env[prefixedName(chain, name)]?.trim();
  if (chainSpecific) {
    return chainSpecific;
  }
  return allowGlobalFallback ? fallback?.trim() || null : null;
}

function parseDecimals(value: string | null | undefined, fallback = 6) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBasisPoints(value: string | null | undefined, fallback = 50) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 10_000 ? parsed : fallback;
}

function parseTimeout(value: string | null | undefined, fallback = parseInt(env.TRADING_AGENTS_TIMEOUT_MS, 10)) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTradingAgentsConfig(chain: SettlementChain): TradingAgentsConfig | null {
  const url = envValue(chain, "TRADING_AGENTS_URL", env.TRADING_AGENTS_URL, chain === "ethereum");
  const secret = envValue(
    chain,
    "TRADING_AGENTS_SECRET",
    env.TRADING_AGENTS_SECRET,
    chain === "ethereum"
  );
  if (!url || !secret) {
    return null;
  }
  return {
    url,
    secret,
    timeoutMs: parseTimeout(
      envValue(
        chain,
        "TRADING_AGENTS_TIMEOUT_MS",
        env.TRADING_AGENTS_TIMEOUT_MS,
        chain === "ethereum"
      )
    )
  };
}

export function getTreasuryAssetForChain(chain: SettlementChain): AssetConfig {
  const token = getSettlementTokenConfig(chain);
  if (!token?.address) {
    throw new Error(`Treasury token is not configured for ${chain}`);
  }
  return {
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals
  };
}

export function getExecutionAssetForChain(chain: SettlementChain): AssetConfig {
  const treasuryAsset = getTreasuryAssetForChain(chain);
  const symbol = (
    envValue(
      chain,
      "INVESTMENT_EXECUTION_TOKEN_SYMBOL",
      env.INVESTMENT_EXECUTION_TOKEN_SYMBOL,
      chain === "ethereum"
    ) ??
    treasuryAsset.symbol
  ).toUpperCase();
  const address = envValue(
    chain,
    "INVESTMENT_EXECUTION_TOKEN_ADDRESS",
    env.INVESTMENT_EXECUTION_TOKEN_ADDRESS,
    chain === "ethereum"
  );
  if (!address) {
    return treasuryAsset;
  }
  return {
    address,
    symbol,
    decimals: parseDecimals(
      envValue(
        chain,
        "INVESTMENT_EXECUTION_TOKEN_DECIMALS",
        env.INVESTMENT_EXECUTION_TOKEN_DECIMALS,
        chain === "ethereum"
      ),
      treasuryAsset.decimals
    )
  };
}

export function getStableSwapConfigForChain(
  chain: SettlementChain,
  treasuryAsset: AssetConfig,
  executionAsset: AssetConfig
): StableSwapConfig | null {
  if (treasuryAsset.address.toLowerCase() === executionAsset.address.toLowerCase()) {
    return null;
  }

  const routerAddress = envValue(
    chain,
    "STABLE_SWAP_ROUTER_ADDRESS",
    env.STABLE_SWAP_ROUTER_ADDRESS,
    chain === "ethereum"
  );
  const quoterAddress = envValue(
    chain,
    "STABLE_SWAP_QUOTER_ADDRESS",
    env.STABLE_SWAP_QUOTER_ADDRESS,
    chain === "ethereum"
  );
  if (!routerAddress || !quoterAddress) {
    return null;
  }

  return {
    routerAddress,
    quoterAddress,
    poolFee: parseDecimals(
      envValue(chain, "STABLE_SWAP_POOL_FEE", env.STABLE_SWAP_POOL_FEE, chain === "ethereum"),
      100
    ),
    slippageBps: parseBasisPoints(
      envValue(
        chain,
        "STABLE_SWAP_SLIPPAGE_BPS",
        env.STABLE_SWAP_SLIPPAGE_BPS,
        chain === "ethereum"
      )
    )
  };
}

export function getEnabledInvestmentProtocols() {
  return new Set(
    (env.INVESTMENT_ENABLED_PROTOCOLS ?? "aave_usdc")
      .split(",")
      .map((item) => canonicalizeInvestmentProtocolKey(item))
      .filter(Boolean)
  );
}

export function canonicalizeInvestmentProtocolKey(value: string | null | undefined) {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^polygon:/, "")
    .replace(/^ethereum:/, "")
    .replace(/-/g, "_");

  return PROTOCOL_KEY_ALIASES[normalized] ?? normalized;
}

function flagEnabled(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase() === "true";
}

export function getInvestmentProtocolAddresses(chain: SettlementChain): ProtocolAddressMap {
  return {
    yearnVaultAddress: envValue(
      chain,
      "YEARN_USDC_VAULT_ADDRESS",
      env.YEARN_USDC_VAULT_ADDRESS,
      chain === "ethereum"
    ),
    aavePoolAddress:
      envValue(
        chain,
        "AAVE_USDC_POOL_ADDRESS",
        env.AAVE_USDC_POOL_ADDRESS,
        chain === "ethereum"
      ) ??
      envValue(chain, "AAVE_POOL_ADDRESS", env.AAVE_POOL_ADDRESS, chain === "ethereum"),
    compoundCometAddress: envValue(
      chain,
      "COMPOUND_USDC_COMET_ADDRESS",
      null,
      false
    ),
    morphoVaultAddress: envValue(
      chain,
      "MORPHO_USDC_VAULT_ADDRESS",
      null,
      false
    ),
    beefyVaultAddress: envValue(
      chain,
      "BEEFY_USDC_VAULT_ADDRESS",
      null,
      false
    ),
    fluidVaultAddress: envValue(
      chain,
      "FLUID_USDC_VAULT_ADDRESS",
      null,
      false
    ),
    pendleRouterAddress: envValue(
      chain,
      "PENDLE_ROUTER_ADDRESS",
      env.PENDLE_ROUTER_ADDRESS,
      chain === "ethereum"
    ),
    pendleMarketAddress: envValue(
      chain,
      "PENDLE_USDC_MARKET_ADDRESS",
      env.PENDLE_USDC_MARKET_ADDRESS,
      chain === "ethereum"
    ),
    pendleSyAddress: envValue(
      chain,
      "PENDLE_USDC_SY_ADDRESS",
      env.PENDLE_USDC_SY_ADDRESS,
      chain === "ethereum"
    )
  };
}

export function getExecutableProtocolsForChain(chain: SettlementChain) {
  const enabled = getEnabledInvestmentProtocols();
  const addresses = getInvestmentProtocolAddresses(chain);
  const executable = new Set<string>();

  if (enabled.has("aave_usdc") && addresses.aavePoolAddress) {
    executable.add("aave_usdc");
  }

  if (enabled.has("compound_v3_usdc") && addresses.compoundCometAddress) {
    executable.add("compound_v3_usdc");
  }

  if (enabled.has("morpho_v1_usdc") && addresses.morphoVaultAddress) {
    executable.add("morpho_v1_usdc");
  }

  if (
    enabled.has("yearn_usdc") &&
    flagEnabled(
      envValue(chain, "YEARN_VAULT_IS_ERC4626", env.YEARN_VAULT_IS_ERC4626, chain === "ethereum")
    ) &&
    addresses.yearnVaultAddress
  ) {
    executable.add("yearn_usdc");
  }

  if (
    enabled.has("pendle_pt_usdc") &&
    flagEnabled(
      envValue(chain, "PENDLE_AUTOMATION_ENABLED", env.PENDLE_AUTOMATION_ENABLED, chain === "ethereum")
    ) &&
    addresses.pendleRouterAddress &&
    addresses.pendleMarketAddress &&
    addresses.pendleSyAddress
  ) {
    executable.add("pendle_pt_usdc");
  }

  return executable;
}

export function getExecutionTokenSymbolForChain(chain: SettlementChain) {
  return getExecutionAssetForChain(chain).symbol;
}
