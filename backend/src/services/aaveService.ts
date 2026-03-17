import { Interface } from "ethers";
import * as AaveProtocolModule from "@tetherto/wdk-protocol-lending-aave-evm";
import type { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { parseTokenAmount, formatTokenAmount } from "../utils/amounts.js";
import { withAdminContext } from "./wdkAdmin.js";

const rpcUrl = env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY);
const WETH_ABI = ["function deposit() payable", "function withdraw(uint256)"];
const wethInterface = new Interface(WETH_ABI);
const AaveLendingProtocol = (AaveProtocolModule as any).default ?? AaveProtocolModule;

type AaveProtocol = {
  supply?: (...args: any[]) => Promise<any>;
  deposit?: (...args: any[]) => Promise<any>;
  withdraw?: (...args: any[]) => Promise<any>;
  redeem?: (...args: any[]) => Promise<any>;
};

function requireEnv(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} is required for WDK Aave integration`);
  }
  return value;
}

function resolveProtocolMethod(protocol: AaveProtocol, names: string[]) {
  for (const name of names) {
    const fn = (protocol as any)?.[name];
    if (typeof fn === "function") {
      return fn.bind(protocol);
    }
  }
  return null;
}

async function callProtocolMethod(
  fn: (...args: any[]) => Promise<any>,
  account: WalletAccountEvm,
  token: string,
  amount: bigint
) {
  if (fn.length <= 1) {
    return fn({ account, token, amount });
  }
  return fn(account, token, amount);
}

function extractTxHash(result: any): string {
  if (!result) {
    throw new Error("Aave transaction returned empty result");
  }
  if (typeof result === "string") {
    return result;
  }
  const hash =
    result.hash ??
    result.txHash ??
    result.transactionHash ??
    result?.tx?.hash ??
    result?.transaction?.hash;
  if (!hash) {
    throw new Error("Aave transaction did not include a hash");
  }
  return hash;
}

function buildAaveProtocol(wdk: unknown): AaveProtocol {
  const wdkAny = wdk as any;
  if (typeof wdkAny.registerProtocol !== "function") {
    throw new Error("WDK protocol registry unavailable; upgrade WDK SDK");
  }
  const config = {
    provider: rpcUrl,
    poolAddress: env.AAVE_POOL_ADDRESS,
    gatewayAddress: env.AAVE_WETH_GATEWAY,
    wethGatewayAddress: env.AAVE_WETH_GATEWAY,
    network: env.DEFAULT_CHAIN,
    chain: env.DEFAULT_CHAIN
  };
  wdkAny.registerProtocol("aave", AaveLendingProtocol as any, config);
  if (typeof wdkAny.getProtocol === "function") {
    return wdkAny.getProtocol("aave") as AaveProtocol;
  }
  if (wdkAny.protocols?.aave) {
    return wdkAny.protocols.aave as AaveProtocol;
  }
  throw new Error("Aave protocol not initialized");
}

async function wrapNative(account: WalletAccountEvm, amount: bigint, wethAddress: string) {
  const data = wethInterface.encodeFunctionData("deposit");
  await account.sendTransaction({ to: wethAddress, data, value: amount });
}

async function unwrapNative(account: WalletAccountEvm, amount: bigint, wethAddress: string) {
  const data = wethInterface.encodeFunctionData("withdraw", [amount]);
  await account.sendTransaction({ to: wethAddress, data, value: 0n });
}

export async function depositToAave(companyId: string, amountEth: number): Promise<string> {
  if (amountEth <= 0) {
    throw new Error(`Invalid deposit amount for ${companyId}`);
  }
  const tokenAddress = requireEnv(env.AAVE_SUPPLY_TOKEN_ADDRESS, "AAVE_SUPPLY_TOKEN_ADDRESS");
  const decimals = parseInt(env.AAVE_SUPPLY_TOKEN_DECIMALS, 10);
  const amountRaw = parseTokenAmount(amountEth, decimals);
  const shouldWrap = env.AAVE_WRAP_NATIVE === "true";
  const wethAddress = env.WETH_ADDRESS;

  return withAdminContext(async ({ wdk, account }) => {
    const protocol = buildAaveProtocol(wdk);
    const balance = await account.getTokenBalance(tokenAddress);
    if (balance < amountRaw) {
      if (
        shouldWrap &&
        wethAddress &&
        tokenAddress.toLowerCase() === wethAddress.toLowerCase()
      ) {
        await wrapNative(account, amountRaw - balance, wethAddress);
      } else {
        throw new Error("Insufficient token balance for Aave deposit");
      }
    }

    const supply = resolveProtocolMethod(protocol, ["supply", "deposit"]);
    if (!supply) {
      throw new Error("Aave supply method not available on protocol module");
    }
    const result = await callProtocolMethod(supply, account, tokenAddress, amountRaw);
    return extractTxHash(result);
  });
}

export async function withdrawFromAave(companyId: string, amountEth: number): Promise<string> {
  if (amountEth <= 0) {
    throw new Error(`Invalid withdrawal amount for ${companyId}`);
  }
  const companyPositionResult = await db.query(
    "SELECT COALESCE(SUM(amount_deposited), 0) AS total_deposited FROM investment_positions WHERE company_id = $1 AND status = 'active'",
    [companyId]
  );
  const companyDeposited = parseFloat(companyPositionResult.rows[0].total_deposited);
  if (amountEth > companyDeposited) {
    throw new Error(`Withdrawal exceeds active Aave position for ${companyId}`);
  }

  const tokenAddress = requireEnv(env.AAVE_SUPPLY_TOKEN_ADDRESS, "AAVE_SUPPLY_TOKEN_ADDRESS");
  const decimals = parseInt(env.AAVE_SUPPLY_TOKEN_DECIMALS, 10);
  const amountRaw = parseTokenAmount(amountEth, decimals);
  const shouldUnwrap = env.AAVE_UNWRAP_NATIVE === "true";
  const wethAddress = env.WETH_ADDRESS;

  return withAdminContext(async ({ wdk, account }) => {
    const protocol = buildAaveProtocol(wdk);
    const withdraw = resolveProtocolMethod(protocol, ["withdraw", "redeem"]);
    if (!withdraw) {
      throw new Error("Aave withdraw method not available on protocol module");
    }
    const result = await callProtocolMethod(withdraw, account, tokenAddress, amountRaw);
    const txHash = extractTxHash(result);

    if (
      shouldUnwrap &&
      wethAddress &&
      tokenAddress.toLowerCase() === wethAddress.toLowerCase()
    ) {
      await unwrapNative(account, amountRaw, wethAddress);
    }

    return txHash;
  });
}

export async function getATokenBalance(companyId: string): Promise<number> {
  const tokenAddress = requireEnv(env.AAVE_ATOKEN_ADDRESS, "AAVE_ATOKEN_ADDRESS");
  const decimals = parseInt(env.AAVE_ATOKEN_DECIMALS, 10);

  const balanceRaw = await withAdminContext(async ({ account }) => {
    return account.getTokenBalance(tokenAddress);
  });
  const balance = parseFloat(formatTokenAmount(balanceRaw, decimals));
  if (!Number.isFinite(balance)) {
    throw new Error(`Invalid aToken balance for ${companyId}`);
  }
  return balance;
}

export async function getYieldEarned(companyId: string): Promise<number> {
  const currentBalance = await getATokenBalance(companyId);

  const result = await db.query(
    "SELECT SUM(amount_deposited) as total_deposited FROM investment_positions WHERE company_id = $1 AND status = 'active'",
    [companyId]
  );

  const totalDeposited = parseFloat(result.rows[0]?.total_deposited || "0");
  const yieldEarned = currentBalance - totalDeposited;

  return Math.max(0, yieldEarned);
}
