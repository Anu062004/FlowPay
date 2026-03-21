import { ethers } from "ethers";
import { env } from "../config/env.js";
import { sendAdminTransaction } from "./wdkAdmin.js";
import { parseAmount } from "../utils/amounts.js";

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

export async function emitVaultPayroll(employeeAddress: string, amountEth: string): Promise<string> {
  const amountWei = parseAmount(amountEth);
  return sendAdminTransaction(
    env.VAULT_CONTRACT_ADDRESS,
    VAULT_ABI,
    "emitPayrollExecuted",
    [employeeAddress, amountWei]
  );
}

export async function emitVaultLoanDisbursed(employeeAddress: string, amountEth: string): Promise<string> {
  const amountWei = parseAmount(amountEth);
  return sendAdminTransaction(
    env.VAULT_CONTRACT_ADDRESS,
    VAULT_ABI,
    "emitLoanDisbursed",
    [employeeAddress, amountWei]
  );
}

export async function allocateVault(
  payrollPct: number,
  lendingPct: number,
  investmentPct: number
): Promise<string> {
  if (payrollPct > 1 || lendingPct > 1 || investmentPct > 1) {
    throw new Error("Percentages must be decimals in [0,1]");
  }

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

  return sendAdminTransaction(
    env.VAULT_CONTRACT_ADDRESS,
    VAULT_ABI,
    "allocate",
    [p, l, i]
  );
}

export async function issueContractLoan(
  employeeAddress: string,
  amountEth: string,
  interestRate: number,
  duration: number
): Promise<string> {
  const amountWei = parseAmount(amountEth);
  return sendAdminTransaction(
    env.LOAN_CONTRACT_ADDRESS,
    LOAN_ABI,
    "issueLoan",
    [employeeAddress, amountWei, Math.floor(interestRate), duration]
  );
}

export async function repayContractEMI(
  contractLoanId: number,
  amountEth: string
): Promise<string> {
  const amountWei = parseAmount(amountEth);
  return sendAdminTransaction(
    env.LOAN_CONTRACT_ADDRESS,
    LOAN_ABI,
    "repayEMI",
    [contractLoanId, amountWei]
  );
}
