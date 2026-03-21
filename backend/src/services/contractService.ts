import { ethers } from "ethers";
import { env } from "../config/env.js";
import { sendAdminTransaction } from "./wdkAdmin.js";
import { formatAmount, parseAmount } from "../utils/amounts.js";
import { getRpcProvider } from "./rpcService.js";

const CORE_ABI = [
  "function initializeEmployee(address employee, uint256 monthlySalary, uint8 employmentType) external",
  "function executePayroll(address employee, uint256 amount) external",
  "function disburseLoan(address employee, uint256 amount) external",
  "function recordEMIMissed(address employee) external",
  "function getScore(address employee) external view returns (uint256)",
  "function getLoanTerms(address employee) external view returns (bool allowed, uint256 maxAmount, uint256 interestRatePct)",
  "function getEmployee(address employee) external view returns (uint256 score, uint256 monthlySalary, uint256 lastPayrollAt, uint256 activeLoans, bool initialized)",
  "function allocate(uint256 payrollPct, uint256 lendingPct, uint256 investmentPct) external",
  "function withdraw(address to, uint256 amount) external"
];

const LOAN_ABI = [
  "event LoanIssued(uint256 indexed loanId, address indexed employee, uint256 amount, uint256 interestRate)",
  "function issueLoan(address employee, uint256 amount, uint256 duration) external returns (uint256 loanId)",
  "function repayEMI(uint256 loanId, uint256 amount) external",
  "function checkEligibility(address employee) external view returns (bool allowed, uint256 maxAmount, uint256 interestRatePct)"
];

function getCoreContract() {
  return new ethers.Contract(env.CORE_CONTRACT_ADDRESS, CORE_ABI, getRpcProvider());
}

function getLoanContract() {
  return new ethers.Contract(env.LOAN_CONTRACT_ADDRESS, LOAN_ABI, getRpcProvider());
}

export async function getCoreEmployeeState(employeeAddress: string) {
  const contract = getCoreContract();
  const [score, monthlySalary, lastPayrollAt, activeLoans, initialized] = await contract.getEmployee(employeeAddress) as [
    bigint,
    bigint,
    bigint,
    bigint,
    boolean
  ];

  return {
    score: Number(score),
    monthlySalaryWei: monthlySalary.toString(),
    monthlySalaryEth: formatAmount(monthlySalary),
    lastPayrollAt: Number(lastPayrollAt),
    activeLoans: Number(activeLoans),
    initialized
  };
}

export async function initializeEmployeeOnCore(
  employeeAddress: string,
  monthlySalaryEth: string | number,
  employmentType = 1
) {
  const monthlySalaryWei = parseAmount(monthlySalaryEth);
  if (monthlySalaryWei <= 0n) {
    throw new Error("Employee salary must be greater than zero before on-chain initialization");
  }

  await sendAdminTransaction(
    env.CORE_CONTRACT_ADDRESS,
    CORE_ABI,
    "initializeEmployee",
    [employeeAddress, monthlySalaryWei, employmentType]
  );

  return getCoreEmployeeState(employeeAddress);
}

export async function ensureEmployeeInitializedOnCore(
  employeeAddress: string,
  monthlySalaryEth: string | number,
  employmentType = 1
) {
  const current = await getCoreEmployeeState(employeeAddress);
  if (current.initialized) {
    return current;
  }

  return initializeEmployeeOnCore(employeeAddress, monthlySalaryEth, employmentType);
}

export async function getEmployeeCreditScoreOnCore(employeeAddress: string) {
  const contract = getCoreContract();
  const score = await contract.getScore(employeeAddress) as bigint;
  return Number(score);
}

export async function checkLoanEligibilityOnCore(employeeAddress: string) {
  const contract = getLoanContract();
  const [allowed, maxAmount, interestRatePct] = await contract.checkEligibility(employeeAddress) as [
    boolean,
    bigint,
    bigint
  ];

  return {
    allowed,
    maxAmountWei: maxAmount.toString(),
    maxAmountEth: formatAmount(maxAmount),
    interestRatePct: Number(interestRatePct)
  };
}

// Payroll and loan cash still move through the company treasury wallet today.
// We call the new core methods with a zero amount to preserve on-chain score/state updates
// without introducing duplicate ETH transfers during this migration.
export async function recordPayrollOnCore(employeeAddress: string): Promise<string> {
  return sendAdminTransaction(
    env.CORE_CONTRACT_ADDRESS,
    CORE_ABI,
    "executePayroll",
    [employeeAddress, 0n]
  );
}

export async function recordLoanDisbursementOnCore(employeeAddress: string): Promise<string> {
  return sendAdminTransaction(
    env.CORE_CONTRACT_ADDRESS,
    CORE_ABI,
    "disburseLoan",
    [employeeAddress, 0n]
  );
}

export async function allocateCore(
  payrollPct: number,
  lendingPct: number,
  investmentPct: number
): Promise<string> {
  if (payrollPct > 1 || lendingPct > 1 || investmentPct > 1) {
    throw new Error("Percentages must be decimals in [0,1]");
  }

  let p = Math.floor(payrollPct * 100);
  let l = Math.floor(lendingPct * 100);
  let i = Math.floor(investmentPct * 100);

  const sum = p + l + i;
  if (sum !== 100) {
    const diff = 100 - sum;
    if (p >= l && p >= i) p += diff;
    else if (l >= p && l >= i) l += diff;
    else i += diff;
  }

  return sendAdminTransaction(
    env.CORE_CONTRACT_ADDRESS,
    CORE_ABI,
    "allocate",
    [p, l, i]
  );
}

export async function issueContractLoan(
  employeeAddress: string,
  amountEth: string,
  duration: number
): Promise<{ txHash: string; contractLoanId: number; interestRatePct: number }> {
  const amountWei = parseAmount(amountEth);
  const txHash = await sendAdminTransaction(
    env.LOAN_CONTRACT_ADDRESS,
    LOAN_ABI,
    "issueLoan",
    [employeeAddress, amountWei, duration]
  );

  const receipt = await getRpcProvider().getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error("Loan issuance receipt is unavailable");
  }

  const iface = new ethers.Interface(LOAN_ABI);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "LoanIssued") {
        return {
          txHash,
          contractLoanId: Number(parsed.args.loanId),
          interestRatePct: Number(parsed.args.interestRate)
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error("LoanIssued event was not found in the contract receipt");
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
