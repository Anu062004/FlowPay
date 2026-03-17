import { env } from "../config/env.js";

const baseUrl = env.WDK_INDEXER_BASE_URL.replace(/\/+$/, "");

async function indexerFetch(path: string) {
  if (!env.WDK_INDEXER_API_KEY) {
    throw new Error("WDK_INDEXER_API_KEY is required for indexer requests");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "x-api-key": env.WDK_INDEXER_API_KEY }
  });
  if (!response.ok) {
    throw new Error(`Indexer request failed (${response.status})`);
  }
  return response.json();
}

export async function getTokenBalance(params: {
  blockchain: string;
  token: string;
  address: string;
}) {
  const { blockchain, token, address } = params;
  const data = await indexerFetch(`/api/v1/${blockchain}/${token}/${address}/token-balances`);
  return data?.tokenBalance ?? data;
}

export async function getTokenTransfers(params: {
  blockchain: string;
  token: string;
  address: string;
  limit?: number;
}) {
  const { blockchain, token, address, limit } = params;
  const qs = limit ? `?limit=${limit}` : "";
  return indexerFetch(`/api/v1/${blockchain}/${token}/${address}/token-transfers${qs}`);
}
