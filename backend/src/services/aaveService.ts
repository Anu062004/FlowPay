import { Contract, JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";

const INVESTMENT_ABI = [
  "function depositToAave() external payable",
  "function withdrawFromAave(uint256 amount) external",
  "function getATokenBalance() external view returns (uint256)",
  "function borrowAgainst(uint256 amount, address asset) external",
  "event Deposited(uint256 amount)",
  "event Withdrawn(uint256 amount)"
];

function getRpcUrl(): string {
  return env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY);
}

export function getInvestmentContract() {
  const provider = new JsonRpcProvider(getRpcUrl());
  const wallet = new Wallet(env.PRIVATE_KEY, provider);
  return new Contract(env.INVESTMENT_CONTRACT_ADDRESS, INVESTMENT_ABI, wallet);
}

export async function depositToAave(companyId: string, amountEth: number): Promise<string> {
  if (amountEth <= 0) {
    throw new Error(`Invalid deposit amount for ${companyId}`);
  }
  const contract = getInvestmentContract();
  const tx = await contract.depositToAave({
    value: parseEther(amountEth.toFixed(18))
  });
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Deposit transaction receipt is empty");
  }
  return receipt.hash;
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

  const contract = getInvestmentContract();
  const amountWei = parseEther(amountEth.toFixed(18));
  const tx = await contract.withdrawFromAave(amountWei);
  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Withdrawal transaction receipt is empty");
  }
  return receipt.hash;
}

export async function getATokenBalance(companyId: string): Promise<number> {
  const contract = getInvestmentContract();
  const balanceWei = await contract.getATokenBalance();
  const balance = parseFloat(formatEther(balanceWei));
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
