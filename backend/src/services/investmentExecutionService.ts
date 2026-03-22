import { Contract, Interface, MaxUint256 } from "ethers";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import type {
  TradingAgentsAllocationAction,
  TradingAgentsAllocationItem,
  TradingAgentsDecision
} from "../clients/tradingAgentsClient.js";
import { sendContractTransaction } from "./walletService.js";
import { withRpcFailover } from "./rpcService.js";
import { formatTokenAmount, parseTokenAmount } from "../utils/amounts.js";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];
const ERC4626_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function maxWithdraw(address owner) view returns (uint256)"
];
const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)"
];
const PENDLE_ROUTER_ABI = [
  "function swapExactTokensForPt(address receiver, address market, uint256 minPtOut, tuple(uint256 netTokenIn, address tokenIn, address tokenMintSy, address pendleSwap, tuple(uint8 swapType, address extRouter, bytes extCalldata, bool needScale) swapData) input) returns (uint256 netPtOut, uint256 netSyFee)"
];
const V3_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"
];
const V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)"
];

type TreasuryWalletContext = {
  walletId: string;
  walletAddress: string;
};

type AssetConfig = {
  address: string;
  symbol: string;
  decimals: number;
};

type ExecutedAllocation = {
  protocolKey: string;
  protocol: string;
  action: TradingAgentsAllocationAction;
  amount: number;
  assetSymbol: string;
  txHash: string;
};

type ClosedPosition = {
  protocolKey: string;
  amount: number;
  assetSymbol: string;
  txHash: string;
};

function round(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return parseFloat(value.toFixed(6));
}

function parseDecimals(value: string, label: string) {
  const decimals = parseInt(value, 10);
  if (!Number.isFinite(decimals) || decimals < 0) {
    throw new Error(`${label} must be a valid non-negative integer`);
  }
  return decimals;
}

function parseBasisPoints(value: string, label: string) {
  const bps = parseInt(value, 10);
  if (!Number.isFinite(bps) || bps < 0 || bps >= 10_000) {
    throw new Error(`${label} must be between 0 and 9999`);
  }
  return bps;
}

function requireAddress(value: string | undefined, label: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} is required for TradingAgents investment execution`);
  }
  return trimmed;
}

function formatAmount(amountRaw: bigint, decimals: number) {
  return round(parseFloat(formatTokenAmount(amountRaw, decimals)));
}

function sameAsset(a: AssetConfig, b: AssetConfig) {
  return a.address.toLowerCase() === b.address.toLowerCase();
}

function getTreasuryAsset(): AssetConfig {
  return {
    address: requireAddress(
      env.TREASURY_TOKEN_ADDRESS,
      "TREASURY_TOKEN_ADDRESS"
    ),
    symbol: (env.TREASURY_TOKEN_SYMBOL?.trim() || "USDT").toUpperCase(),
    decimals: parseDecimals(env.TREASURY_TOKEN_DECIMALS, "TREASURY_TOKEN_DECIMALS")
  };
}

function getExecutionAsset(treasuryAsset: AssetConfig): AssetConfig {
  const executionSymbol = (
    env.INVESTMENT_EXECUTION_TOKEN_SYMBOL?.trim() || treasuryAsset.symbol
  ).toUpperCase();
  const executionAddress = env.INVESTMENT_EXECUTION_TOKEN_ADDRESS?.trim();

  if (!executionAddress) {
    if (executionSymbol === treasuryAsset.symbol) {
      return treasuryAsset;
    }
    throw new Error(
      `INVESTMENT_EXECUTION_TOKEN_ADDRESS is required when treasury ${treasuryAsset.symbol} differs from execution ${executionSymbol}`
    );
  }

  return {
    address: executionAddress,
    symbol: executionSymbol,
    decimals: parseDecimals(
      env.INVESTMENT_EXECUTION_TOKEN_DECIMALS,
      "INVESTMENT_EXECUTION_TOKEN_DECIMALS"
    )
  };
}

function getStableSwapConfig(treasuryAsset: AssetConfig, executionAsset: AssetConfig) {
  if (sameAsset(treasuryAsset, executionAsset)) {
    return null;
  }

  return {
    routerAddress: requireAddress(
      env.STABLE_SWAP_ROUTER_ADDRESS,
      "STABLE_SWAP_ROUTER_ADDRESS"
    ),
    quoterAddress: requireAddress(
      env.STABLE_SWAP_QUOTER_ADDRESS,
      "STABLE_SWAP_QUOTER_ADDRESS"
    ),
    poolFee: parseInt(env.STABLE_SWAP_POOL_FEE, 10),
    slippageBps: parseBasisPoints(env.STABLE_SWAP_SLIPPAGE_BPS, "STABLE_SWAP_SLIPPAGE_BPS")
  };
}

async function getTreasuryWalletContext(companyId: string): Promise<TreasuryWalletContext> {
  const result = await db.query(
    `SELECT w.id AS wallet_id, w.wallet_address
     FROM companies c
     JOIN wallets w ON w.id = c.treasury_wallet_id
     WHERE c.id = $1`,
    [companyId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Company treasury wallet not found");
  }

  return {
    walletId: result.rows[0].wallet_id,
    walletAddress: result.rows[0].wallet_address
  };
}

async function getCompanyIdForWallet(walletId: string) {
  const result = await db.query("SELECT owner_id FROM wallets WHERE id = $1", [walletId]);
  if ((result.rowCount ?? 0) === 0) {
    throw new Error("Wallet owner not found");
  }
  return result.rows[0].owner_id as string;
}

async function getTokenBalanceRaw(tokenAddress: string, walletAddress: string) {
  return withRpcFailover(`erc20 balanceOf ${tokenAddress}`, async (provider) => {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    return (await token.balanceOf(walletAddress)) as bigint;
  });
}

async function ensureAllowance(params: {
  walletId: string;
  walletAddress: string;
  token: AssetConfig;
  spender: string;
  amountRaw: bigint;
}) {
  const currentAllowance = await withRpcFailover("erc20 allowance", async (provider) => {
    const token = new Contract(params.token.address, ERC20_ABI, provider);
    return (await token.allowance(params.walletAddress, params.spender)) as bigint;
  });

  if (currentAllowance >= params.amountRaw) {
    return;
  }

  const iface = new Interface(ERC20_ABI);
  const data = iface.encodeFunctionData("approve", [params.spender, MaxUint256]);
  await sendContractTransaction({
    fromWalletId: params.walletId,
    toAddress: params.token.address,
    data,
    type: "investment",
    amount: 0,
    tokenSymbol: params.token.symbol,
    recordTransaction: false
  });
}

function buildAllocationMetadata(protocolKey: string) {
  switch (protocolKey) {
    case "yearn_usdc":
      return {
        contractAddress: requireAddress(
          env.YEARN_USDC_VAULT_ADDRESS,
          "YEARN_USDC_VAULT_ADDRESS"
        ),
        spender: requireAddress(
          env.YEARN_USDC_VAULT_ADDRESS,
          "YEARN_USDC_VAULT_ADDRESS"
        )
      };
    case "aave_usdc":
      return {
        contractAddress: requireAddress(
          env.AAVE_USDC_POOL_ADDRESS ?? env.AAVE_POOL_ADDRESS,
          "AAVE_USDC_POOL_ADDRESS"
        ),
        spender: requireAddress(
          env.AAVE_USDC_POOL_ADDRESS ?? env.AAVE_POOL_ADDRESS,
          "AAVE_USDC_POOL_ADDRESS"
        )
      };
    case "pendle_pt_usdc":
      return {
        contractAddress: requireAddress(env.PENDLE_ROUTER_ADDRESS, "PENDLE_ROUTER_ADDRESS"),
        spender: requireAddress(env.PENDLE_ROUTER_ADDRESS, "PENDLE_ROUTER_ADDRESS"),
        marketAddress: requireAddress(
          env.PENDLE_USDC_MARKET_ADDRESS,
          "PENDLE_USDC_MARKET_ADDRESS"
        ),
        syAddress: requireAddress(env.PENDLE_USDC_SY_ADDRESS, "PENDLE_USDC_SY_ADDRESS")
      };
    default:
      throw new Error(`Unsupported investment protocol ${protocolKey}`);
  }
}

async function quoteStableSwap(params: {
  quoterAddress: string;
  tokenIn: AssetConfig;
  tokenOut: AssetConfig;
  fee: number;
  amountInRaw: bigint;
}) {
  return withRpcFailover("stable swap quote", async (provider) => {
    const quoter = new Contract(params.quoterAddress, V3_QUOTER_ABI, provider);
    return (await quoter.quoteExactInputSingle(
      params.tokenIn.address,
      params.tokenOut.address,
      params.fee,
      params.amountInRaw,
      0
    )) as bigint;
  });
}

function minAmountOut(quotedAmountRaw: bigint, slippageBps: number) {
  const numerator = BigInt(10_000 - slippageBps);
  const minOut = (quotedAmountRaw * numerator) / 10_000n;
  if (minOut <= 0n) {
    throw new Error("Stable swap quote after slippage is zero");
  }
  return minOut;
}

async function swapStableAsset(params: {
  treasury: TreasuryWalletContext;
  tokenIn: AssetConfig;
  tokenOut: AssetConfig;
  amountInRaw: bigint;
  transactionType: "investment" | "withdrawal";
  recordTransaction: boolean;
}) {
  const swapConfig = getStableSwapConfig(params.tokenIn, params.tokenOut);
  if (!swapConfig) {
    return {
      amountOutRaw: params.amountInRaw,
      txHash: null
    };
  }

  await ensureAllowance({
    walletId: params.treasury.walletId,
    walletAddress: params.treasury.walletAddress,
    token: params.tokenIn,
    spender: swapConfig.routerAddress,
    amountRaw: params.amountInRaw
  });

  const quotedAmountRaw = await quoteStableSwap({
    quoterAddress: swapConfig.quoterAddress,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    fee: swapConfig.poolFee,
    amountInRaw: params.amountInRaw
  });
  const amountOutMinimum = minAmountOut(quotedAmountRaw, swapConfig.slippageBps);
  const balanceBefore = await getTokenBalanceRaw(
    params.tokenOut.address,
    params.treasury.walletAddress
  );

  const iface = new Interface(V3_ROUTER_ABI);
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const data = iface.encodeFunctionData("exactInputSingle", [
    {
      tokenIn: params.tokenIn.address,
      tokenOut: params.tokenOut.address,
      fee: swapConfig.poolFee,
      recipient: params.treasury.walletAddress,
      deadline,
      amountIn: params.amountInRaw,
      amountOutMinimum,
      sqrtPriceLimitX96: 0
    }
  ]);

  const tx = await sendContractTransaction({
    fromWalletId: params.treasury.walletId,
    toAddress: swapConfig.routerAddress,
    data,
    type: params.transactionType,
    amount: formatAmount(params.amountInRaw, params.tokenIn.decimals),
    tokenSymbol: params.tokenIn.symbol,
    recordTransaction: params.recordTransaction
  });

  const balanceAfter = await getTokenBalanceRaw(
    params.tokenOut.address,
    params.treasury.walletAddress
  );
  const amountOutRaw = balanceAfter - balanceBefore;
  if (amountOutRaw <= 0n) {
    throw new Error(
      `Stable swap from ${params.tokenIn.symbol} to ${params.tokenOut.symbol} returned no output`
    );
  }

  return {
    amountOutRaw,
    txHash: tx.txHash
  };
}

async function executeAllocation(params: {
  treasury: TreasuryWalletContext;
  protocolKey: string;
  allocation: TradingAgentsAllocationItem;
}): Promise<ExecutedAllocation> {
  const treasuryAsset = getTreasuryAsset();
  const executionAsset = getExecutionAsset(treasuryAsset);
  const metadata = buildAllocationMetadata(params.protocolKey);

  let protocolAmountRaw = parseTokenAmount(
    params.allocation.amount_usdc,
    executionAsset.decimals
  );

  if (!sameAsset(treasuryAsset, executionAsset)) {
    const treasuryAmountRaw = parseTokenAmount(
      params.allocation.amount_usdc,
      treasuryAsset.decimals
    );
    const swap = await swapStableAsset({
      treasury: params.treasury,
      tokenIn: treasuryAsset,
      tokenOut: executionAsset,
      amountInRaw: treasuryAmountRaw,
      transactionType: "investment",
      recordTransaction: false
    });
    protocolAmountRaw = swap.amountOutRaw;
  }

  await ensureAllowance({
    walletId: params.treasury.walletId,
    walletAddress: params.treasury.walletAddress,
    token: executionAsset,
    spender: metadata.spender,
    amountRaw: protocolAmountRaw
  });

  let toAddress = metadata.contractAddress;
  let data: string;

  if (params.allocation.action === "deposit") {
    const iface = new Interface(ERC4626_ABI);
    data = iface.encodeFunctionData("deposit", [
      protocolAmountRaw,
      params.treasury.walletAddress
    ]);
  } else if (params.allocation.action === "supply") {
    const iface = new Interface(AAVE_POOL_ABI);
    data = iface.encodeFunctionData("supply", [
      executionAsset.address,
      protocolAmountRaw,
      params.treasury.walletAddress,
      0
    ]);
  } else if (params.allocation.action === "swap_to_pt") {
    const iface = new Interface(PENDLE_ROUTER_ABI);
    data = iface.encodeFunctionData("swapExactTokensForPt", [
      params.treasury.walletAddress,
      metadata.marketAddress,
      0,
      {
        netTokenIn: protocolAmountRaw,
        tokenIn: executionAsset.address,
        tokenMintSy: metadata.syAddress,
        pendleSwap: "0x0000000000000000000000000000000000000000",
        swapData: {
          swapType: 0,
          extRouter: "0x0000000000000000000000000000000000000000",
          extCalldata: "0x",
          needScale: false
        }
      }
    ]);
  } else {
    throw new Error(`Unsupported allocation action ${params.allocation.action}`);
  }

  const result = await sendContractTransaction({
    fromWalletId: params.treasury.walletId,
    toAddress,
    data,
    type: "investment",
    amount: formatAmount(protocolAmountRaw, executionAsset.decimals),
    tokenSymbol: executionAsset.symbol
  });

  const depositedAmount = formatAmount(protocolAmountRaw, executionAsset.decimals);
  await db.query(
    `INSERT INTO investment_positions
       (company_id, protocol, amount_deposited, atoken_balance, yield_earned, tx_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [
      await getCompanyIdForWallet(params.treasury.walletId),
      params.protocolKey,
      depositedAmount.toFixed(6),
      depositedAmount.toFixed(6),
      "0.000000",
      result.txHash
    ]
  );

  return {
    protocolKey: params.protocolKey,
    protocol: params.allocation.protocol,
    action: params.allocation.action,
    amount: depositedAmount,
    assetSymbol: executionAsset.symbol,
    txHash: result.txHash
  };
}

async function getYearnWithdrawableAssets(vaultAddress: string, walletAddress: string) {
  return withRpcFailover("yearn maxWithdraw", async (provider) => {
    const vault = new Contract(vaultAddress, ERC4626_ABI, provider);
    return (await vault.maxWithdraw(walletAddress)) as bigint;
  });
}

async function closePosition(
  treasury: TreasuryWalletContext,
  position: {
    id: string;
    protocol: string;
    amount_deposited: string;
  }
): Promise<ClosedPosition> {
  const treasuryAsset = getTreasuryAsset();
  const executionAsset = getExecutionAsset(treasuryAsset);
  const swapBackToTreasury = !sameAsset(treasuryAsset, executionAsset);
  const executionBalanceBefore = await getTokenBalanceRaw(
    executionAsset.address,
    treasury.walletAddress
  );

  let protocolTxHash: string;

  if (position.protocol === "yearn_usdc") {
    const vaultAddress = requireAddress(
      env.YEARN_USDC_VAULT_ADDRESS,
      "YEARN_USDC_VAULT_ADDRESS"
    );
    const withdrawableAssets = await getYearnWithdrawableAssets(
      vaultAddress,
      treasury.walletAddress
    );
    const fallbackAmount = parseTokenAmount(
      position.amount_deposited,
      executionAsset.decimals
    );
    const assetsToWithdraw = withdrawableAssets > 0n ? withdrawableAssets : fallbackAmount;
    const iface = new Interface(ERC4626_ABI);
    const data = iface.encodeFunctionData("withdraw", [
      assetsToWithdraw,
      treasury.walletAddress,
      treasury.walletAddress
    ]);
    const tx = await sendContractTransaction({
      fromWalletId: treasury.walletId,
      toAddress: vaultAddress,
      data,
      type: "withdrawal",
      amount: formatAmount(assetsToWithdraw, executionAsset.decimals),
      tokenSymbol: executionAsset.symbol,
      recordTransaction: !swapBackToTreasury
    });
    protocolTxHash = tx.txHash;
  } else if (position.protocol === "aave_usdc") {
    const poolAddress = requireAddress(
      env.AAVE_USDC_POOL_ADDRESS ?? env.AAVE_POOL_ADDRESS,
      "AAVE_USDC_POOL_ADDRESS"
    );
    const iface = new Interface(AAVE_POOL_ABI);
    const data = iface.encodeFunctionData("withdraw", [
      executionAsset.address,
      MaxUint256,
      treasury.walletAddress
    ]);
    const tx = await sendContractTransaction({
      fromWalletId: treasury.walletId,
      toAddress: poolAddress,
      data,
      type: "withdrawal",
      amount: parseFloat(position.amount_deposited),
      tokenSymbol: executionAsset.symbol,
      recordTransaction: !swapBackToTreasury
    });
    protocolTxHash = tx.txHash;
  } else if (position.protocol === "pendle_pt_usdc") {
    throw new Error(
      "Manual unwind required for existing Pendle PT positions before automated rebalancing can continue"
    );
  } else {
    throw new Error(`Unsupported active position protocol ${position.protocol}`);
  }

  const executionBalanceAfter = await getTokenBalanceRaw(
    executionAsset.address,
    treasury.walletAddress
  );
  const withdrawnExecutionRaw = executionBalanceAfter - executionBalanceBefore;
  if (withdrawnExecutionRaw <= 0n) {
    throw new Error(`Failed to detect withdrawn ${executionAsset.symbol} for ${position.protocol}`);
  }

  let finalTxHash = protocolTxHash;
  let settledAmount = formatAmount(withdrawnExecutionRaw, executionAsset.decimals);
  let settledSymbol = executionAsset.symbol;

  if (swapBackToTreasury) {
    const swap = await swapStableAsset({
      treasury,
      tokenIn: executionAsset,
      tokenOut: treasuryAsset,
      amountInRaw: withdrawnExecutionRaw,
      transactionType: "withdrawal",
      recordTransaction: true
    });
    finalTxHash = swap.txHash ?? protocolTxHash;
    settledAmount = formatAmount(swap.amountOutRaw, treasuryAsset.decimals);
    settledSymbol = treasuryAsset.symbol;
  }

  await db.query(
    "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
    [position.id]
  );

  return {
    protocolKey: position.protocol,
    amount: settledAmount,
    assetSymbol: settledSymbol,
    txHash: finalTxHash
  };
}

export async function getCurrentInvestmentAllocation(companyId: string) {
  const result = await db.query(
    `SELECT protocol, COALESCE(SUM(amount_deposited), 0) AS total
     FROM investment_positions
     WHERE company_id = $1
       AND status = 'active'
     GROUP BY protocol`,
    [companyId]
  );

  const allocation: Record<string, number> = {};
  for (const row of result.rows) {
    allocation[row.protocol] = parseFloat(row.total);
  }
  return allocation;
}

export async function closeActiveInvestmentPositions(companyId: string) {
  const treasury = await getTreasuryWalletContext(companyId);
  const positions = await db.query(
    `SELECT id, protocol, amount_deposited
     FROM investment_positions
     WHERE company_id = $1
       AND status = 'active'
     ORDER BY opened_at ASC`,
    [companyId]
  );

  const closed: ClosedPosition[] = [];
  for (const position of positions.rows) {
    closed.push(await closePosition(treasury, position));
  }
  return closed;
}

export async function executeInvestmentDecision(
  companyId: string,
  decision: TradingAgentsDecision
) {
  const treasury = await getTreasuryWalletContext(companyId);
  const executions: ExecutedAllocation[] = [];

  for (const [protocolKey, allocation] of Object.entries(decision.allocation)) {
    executions.push(
      await executeAllocation({
        treasury,
        protocolKey,
        allocation
      })
    );
  }

  return executions;
}
