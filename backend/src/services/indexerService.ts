import { env } from "../config/env.js";
import { Contract, isAddress } from "ethers";
import { withRpcFailoverForChain } from "./rpcService.js";
import { getSettlementTokenConfig, normalizeSettlementChain } from "../utils/settlement.js";

const baseUrl = env.WDK_INDEXER_BASE_URL.replace(/\/+$/, "");
const INDEXER_MAX_ATTEMPTS = 3;
const SUPPORTED_EVM_CHAINS = new Set(["ethereum", "polygon", "sepolia"]);
const RETRIABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];

type IndexerError = Error & {
  status?: number;
};

function createIndexerError(status: number) {
  const error = new Error(`Indexer request failed (${status})`) as IndexerError;
  error.status = status;
  return error;
}

function getErrorStatus(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
}

function isRetriableIndexerFailure(error: unknown) {
  const status = getErrorStatus(error);
  return status === undefined || RETRIABLE_STATUS_CODES.has(status);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRpcTokenAddress(blockchain: string, token: string) {
  const normalizedBlockchain = blockchain.toLowerCase();
  const normalizedToken = token.toLowerCase();
  if (!SUPPORTED_EVM_CHAINS.has(normalizedBlockchain)) {
    return null;
  }

  if (isAddress(normalizedToken)) {
    return normalizedToken;
  }

  const settlementChain = normalizeSettlementChain(normalizedBlockchain, "ethereum");
  if (settlementChain === normalizedBlockchain) {
    const tokenConfig = getSettlementTokenConfig(settlementChain);
    if (tokenConfig && normalizedToken === tokenConfig.symbol.toLowerCase()) {
      return tokenConfig.address;
    }
  }

  return null;
}

async function getTokenBalanceViaRpc(params: {
  blockchain: string;
  token: string;
  address: string;
}) {
  const tokenAddress = resolveRpcTokenAddress(params.blockchain, params.token);
  if (!tokenAddress) {
    throw new Error("RPC token balance fallback is unavailable for this blockchain/token");
  }

  const balance = await withRpcFailoverForChain(
    params.blockchain,
    "indexer rpc token balance fallback",
    async (provider) => {
      const token = new Contract(tokenAddress, ERC20_ABI, provider);
      return (await token.balanceOf(params.address)) as bigint;
    }
  );
  return { amount: balance.toString(), source: "rpc_fallback" };
}

async function indexerFetch(path: string) {
  if (!env.WDK_INDEXER_API_KEY) {
    throw new Error("WDK_INDEXER_API_KEY is required for indexer requests");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= INDEXER_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { "x-api-key": env.WDK_INDEXER_API_KEY },
        signal: AbortSignal.timeout(15_000)
      });
      if (!response.ok) {
        throw createIndexerError(response.status);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt >= INDEXER_MAX_ATTEMPTS || !isRetriableIndexerFailure(error)) {
        throw error;
      }
      await wait(250 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export async function getTokenBalance(params: {
  blockchain: string;
  token: string;
  address: string;
}) {
  const { blockchain, token, address } = params;
  const normalizedToken = token.toLowerCase();
  try {
    const data = await indexerFetch(`/api/v1/${blockchain}/${normalizedToken}/${address}/token-balances`);
    return data?.tokenBalance ?? data;
  } catch (error) {
    const tokenAddress = resolveRpcTokenAddress(blockchain, normalizedToken);
    if (!tokenAddress) {
      throw error;
    }

    console.warn(
      `[Indexer] Falling back to direct RPC token balance for ${address} on ${blockchain}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return getTokenBalanceViaRpc({ blockchain, token: normalizedToken, address });
  }
}

export async function getTokenTransfers(params: {
  blockchain: string;
  token: string;
  address: string;
  limit?: number;
}) {
  const { blockchain, token, address, limit } = params;
  const normalizedToken = token.toLowerCase();
  const qs = limit ? `?limit=${limit}` : "";
  return indexerFetch(`/api/v1/${blockchain}/${normalizedToken}/${address}/token-transfers${qs}`);
}
