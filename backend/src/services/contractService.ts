import { ethers } from "ethers";
import { env } from "../config/env.js";

// ABI for FlowPayVault
const VAULT_ABI = [
  "function allocate(uint256 payrollPct, uint256 lendingPct, uint256 investmentPct) external",
  "function emitPayrollExecuted(address employee, uint256 amount) external",
  "function emitLoanDisbursed(address employee, uint256 amount) external"
];

// ABI for FlowPayLoan
const LOAN_ABI = [
  "function issueLoan(address employee, uint256 amount, uint256 interestRate, uint256 duration) external returns (uint256)",
  "function repayEMI(uint256 loanId, uint256 amount) external"
];

export async function getVaultContract() {
  const provider = new ethers.JsonRpcProvider(env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY));
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
  return new ethers.Contract(env.VAULT_CONTRACT_ADDRESS, VAULT_ABI, wallet);
}

export async function getLoanContract() {
  const provider = new ethers.JsonRpcProvider(env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY));
  const wallet = new ethers.Wallet(env.PRIVATE_KEY, provider);
  return new ethers.Contract(env.LOAN_CONTRACT_ADDRESS, LOAN_ABI, wallet);
}

export async function emitVaultPayroll(employeeAddress: string, amountEth: string) {
  const vault = await getVaultContract();
  const amountWei = ethers.parseEther(amountEth);
  const tx = await vault.emitPayrollExecuted(employeeAddress, amountWei);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function emitVaultLoanDisbursed(employeeAddress: string, amountEth: string) {
  const vault = await getVaultContract();
  const amountWei = ethers.parseEther(amountEth);
  const tx = await vault.emitLoanDisbursed(employeeAddress, amountWei);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function allocateVault(payrollPct: number, lendingPct: number, investmentPct: number) {
  if (payrollPct > 1 || lendingPct > 1 || investmentPct > 1) {
    throw new Error("Percentages must be decimals in [0,1]");
  }
  const vault = await getVaultContract();
  
  // Fix rounding: Ensure sum is exactly 100
  let p = Math.floor(payrollPct * 100);
  let l = Math.floor(lendingPct * 100);
  let i = Math.floor(investmentPct * 100);
  
  const sum = p + l + i;
  if (sum !== 100) {
    const diff = 100 - sum;
    // Add remainder to the largest bucket
    if (p >= l && p >= i) p += diff;
    else if (l >= p && l >= i) l += diff;
    else i += diff;
  }

  const tx = await vault.allocate(p, l, i);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function issueContractLoan(employeeAddress: string, amountEth: string, interestRate: number, duration: number) {
  const loanContract = await getLoanContract();
  const amountWei = ethers.parseEther(amountEth);
  const tx = await loanContract.issueLoan(employeeAddress, amountWei, Math.floor(interestRate), duration);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function repayContractEMI(contractLoanId: number, amountEth: string) {
  const loanContract = await getLoanContract();
  const amountWei = ethers.parseEther(amountEth);
  const tx = await loanContract.repayEMI(contractLoanId, amountWei);
  const receipt = await tx.wait();
  return receipt.hash;
}
