import { db } from "../db/pool.js";
import { runLoanDecisionAgent } from "../agents/loanAgent.js";
import { ApiError } from "../utils/errors.js";
import {
  checkLoanEligibilityOnCore,
  ensureEmployeeInitializedOnCore
} from "./contractService.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { getCompanySettings } from "./settingsService.js";
import { evaluateAgentPolicy } from "./agentPolicyService.js";
import { env } from "../config/env.js";
import { generateTierProof } from "../zk/generateTierProof.js";
import { deriveCompanySalt } from "../zk/poseidon.js";
import {
  registerEmployeeCommitOnVerifier,
  verifyScoreTierOnChain
} from "./scoreTierVerifierService.js";
import {
  buildFallbackLoanDecision,
  calculateEmi,
  executeLoanDisbursement,
  getEmployeeRepaymentMetrics,
  getScoreTierContext,
  insertRejectedLoan,
  syncEmployeeCreditScore,
  type LoanExecutionRow
} from "./loanFlowSupport.js";
import {
  createLoanReviewTask,
  expirePendingReviewLoans,
  listPendingReviewLoans,
  rejectPendingReviewLoan,
  syncLoanReviewWorkflowState
} from "./loanReviewService.js";
import { repayLoanEmi, repayLoanInFull } from "./loanRepaymentService.js";
import { sendLoanReviewStatusEmail } from "./emailService.js";

export { expirePendingReviewLoans, listPendingReviewLoans, rejectPendingReviewLoan, repayLoanEmi, repayLoanInFull };

function getTreasuryCurrency() {
  return env.TREASURY_TOKEN_SYMBOL?.trim() || "ETH";
}

export async function requestLoan(
  employeeId: string,
  requestedAmount: number,
  auditContext: AgentLogContext = {}
) {
  await expirePendingReviewLoans();
  const treasuryCurrency = getTreasuryCurrency();

  const empCompanyResult = await db.query("SELECT company_id FROM employees WHERE id = $1", [employeeId]);
  if ((empCompanyResult.rowCount ?? 0) > 0) {
    const settings = await getCompanySettings(empCompanyResult.rows[0].company_id);
    if (settings.agent?.lending_paused === true) {
      throw new ApiError(403, "Lending temporarily paused due to elevated default risk");
    }
  }

  const result = await db.query(
    `SELECT
       e.id,
       e.full_name,
       COALESCE(e.email, '') AS email,
       e.salary,
       e.wallet_id,
       e.company_id,
       w.wallet_address,
       c.treasury_wallet_id
     FROM employees e
     JOIN wallets w ON e.wallet_id = w.id
     JOIN companies c ON e.company_id = c.id
     WHERE e.id = $1`,
    [employeeId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Employee not found or missing wallet");
  }

  const employee = result.rows[0];
  const existingLoan = await db.query(
    `SELECT id, status
     FROM loans
     WHERE employee_id = $1
       AND status IN ('pending', 'pending_review', 'active')
     ORDER BY created_at DESC
     LIMIT 1`,
    [employeeId]
  );
  if ((existingLoan.rowCount ?? 0) > 0) {
    throw new ApiError(400, `Existing ${existingLoan.rows[0].status} loan must be resolved before requesting another.`);
  }

  const salary = parseFloat(employee.salary);
  await ensureEmployeeInitializedOnCore(employee.company_id, employee.wallet_address, salary, 1);
  const syncedScore = await syncEmployeeCreditScore(
    employee.company_id,
    employeeId,
    employee.wallet_address,
    employee.salary
  );

  // Chain gate: FlowPayCore is the non-bypassable hard floor for loan eligibility.
  if (syncedScore < 300) {
    throw new ApiError(400, "FlowPayCore minimum score not met");
  }

  // Agent gate: business rule floor before the AI agent sees any applicant context.
  if (syncedScore < 450) {
    throw new ApiError(400, "Score too low - keep receiving payroll to qualify");
  }

  const eligibility = await checkLoanEligibilityOnCore(employee.wallet_address);
  const maxEligibleAmount = parseFloat(eligibility.maxAmountEth);
  if (!eligibility.allowed || maxEligibleAmount <= 0) {
    throw new ApiError(400, "Employee is not eligible for a loan under FlowPayCore");
  }
  if (requestedAmount > maxEligibleAmount) {
    throw new ApiError(400, `Requested amount exceeds FlowPayCore limit (${maxEligibleAmount} ${treasuryCurrency})`);
  }

  const tierContext = getScoreTierContext(syncedScore);
  if (!tierContext) {
    throw new ApiError(400, "No agent score tier is available for the current score");
  }

  const companySalt = deriveCompanySalt(employee.company_id, env.MASTER_KEY);
  const proof = await generateTierProof({
    employeeAddr: employee.wallet_address,
    actualScore: syncedScore,
    tierMin: tierContext.tierMin,
    tierMax: tierContext.tierMax,
    companySalt
  });
  await registerEmployeeCommitOnVerifier(employee.company_id, employee.wallet_address, companySalt);
  const verification = await verifyScoreTierOnChain({
    companyId: employee.company_id,
    employeeAddr: employee.wallet_address,
    solidityCalldata: proof.solidityCalldata
  });

  const repaymentMetrics = await getEmployeeRepaymentMetrics(employeeId);
  const agentInput = {
    salary,
    tier_label: tierContext.label,
    tier_limit_amount: maxEligibleAmount,
    max_multiplier: tierContext.maxMultiplier,
    interest_rate: eligibility.interestRatePct,
    proof_verified: verification.verified,
    requested_amount: requestedAmount,
    repayment_rate: repaymentMetrics.repaymentRate,
    avg_days_to_close: repaymentMetrics.avgDaysToClose,
    missed_emi_count: repaymentMetrics.missedEmiCount,
    closed_loans_count: repaymentMetrics.totalClosed,
    has_prior_loans: repaymentMetrics.hasPriorLoans
  };

  const decision = await runLoanDecisionAgent(agentInput).catch(() =>
    buildFallbackLoanDecision({
      salary,
      requestedAmount,
      tierLimitAmount: maxEligibleAmount,
      tierInterestRate: eligibility.interestRatePct,
      tierLabel: tierContext.label,
      repaymentRate: repaymentMetrics.repaymentRate,
      hasPriorLoans: repaymentMetrics.hasPriorLoans
    })
  );

  await logAgentAction(
    "LoanDecisionAgent",
    agentInput,
    decision,
    decision.rationale,
    decision.decision === "approve"
      ? `Approved loan of ${decision.amount} ${treasuryCurrency}`
      : `Rejected loan request of ${requestedAmount} ${treasuryCurrency}`,
    employee.company_id,
    {
      ...auditContext,
      stage: "decision",
      metadata: {
        proofVerified: verification.verified,
        verifierTxHash: verification.txHash,
        scoreTier: tierContext.label
      }
    }
  );

  if (decision.decision === "reject") {
    const loanId = await insertRejectedLoan(employeeId, requestedAmount, eligibility.interestRatePct, decision.duration, decision.rationale);
    return { decision: "reject" as const, loanId, rationale: decision.rationale };
  }

  const approvedAmount = Math.min(decision.amount, maxEligibleAmount);
  const approvedInterest = eligibility.interestRatePct;
  if (approvedAmount <= 0) {
    throw new ApiError(400, "No loan amount is eligible under FlowPayCore");
  }

  const emi = calculateEmi(approvedAmount, approvedInterest, decision.duration);
  if (emi > salary * 0.3) {
    throw new ApiError(400, "EMI exceeds 30% salary policy");
  }

  // Policy gate: wallet policy can still block or require HR review after chain and agent approval.
  const policyResult = await evaluateAgentPolicy({
    companyId: employee.company_id,
    action: "loan_disbursement",
    amount: approvedAmount,
    metadata: { employeeId }
  });

  await logAgentAction(
    "FlowPayPolicyEngine",
    { companyId: employee.company_id, employeeId, requestedAmount, approvedAmount, emi },
    { action: "loan_disbursement" },
    policyResult.reasons.join(" ") || "Loan disbursal passed wallet policy checks.",
    `Loan disbursal policy status: ${policyResult.status.toUpperCase()}`,
    employee.company_id,
    { ...auditContext, stage: "policy_validation", policyResult, executionStatus: policyResult.status }
  );

  if (policyResult.status === "block") {
    const loanId = await insertRejectedLoan(employeeId, approvedAmount, approvedInterest, decision.duration, policyResult.reasons[0] ?? "Loan blocked by wallet policy.");
    return { decision: "reject" as const, loanId, rationale: policyResult.reasons[0] ?? "Loan blocked by wallet policy.", policy: policyResult };
  }

  if (policyResult.status === "review") {
    const reviewResult = await db.query(
      `INSERT INTO loans (
         employee_id, amount, interest_rate, duration_months, remaining_balance, status, contract_synced,
         review_requested_at, review_expires_at, review_reason
       )
       VALUES ($1, $2, $3, $4, $5, 'pending_review', false, now(), now() + interval '48 hours', $6)
       RETURNING id, review_requested_at, review_expires_at`,
      [employeeId, approvedAmount, approvedInterest, decision.duration, approvedAmount, policyResult.reasons.join(" ") || "Pending HR review."]
    );

    const loanId = reviewResult.rows[0].id as string;
    await createLoanReviewTask({
      loanId,
      companyId: employee.company_id,
      employeeId,
      employeeName: employee.full_name,
      employeeEmail: employee.email || null,
      amount: approvedAmount,
      interest: approvedInterest,
      duration: decision.duration,
      emi,
      rationale: decision.rationale,
      tierLabel: tierContext.label,
      repaymentMetrics,
      policyResult
    });

    return {
      decision: "review" as const,
      loanId,
      status: "pending_review" as const,
      amount: approvedAmount,
      interest: approvedInterest,
      duration: decision.duration,
      emi,
      rationale: policyResult.reasons[0] ?? "Loan queued for HR review.",
      proofVerified: verification.verified,
      reviewRequestedAt: reviewResult.rows[0].review_requested_at,
      reviewExpiresAt: reviewResult.rows[0].review_expires_at,
      policy: policyResult
    };
  }

  const loanResult = await db.query(
    `INSERT INTO loans (employee_id, amount, interest_rate, duration_months, remaining_balance, status, contract_synced)
     VALUES ($1, $2, $3, $4, $5, 'active', false)
     RETURNING id`,
    [employeeId, approvedAmount, approvedInterest, decision.duration, approvedAmount]
  );

  const executionRow: LoanExecutionRow = {
    id: loanResult.rows[0].id as string,
    amount: approvedAmount.toString(),
    interest_rate: approvedInterest.toString(),
    duration_months: decision.duration.toString(),
    status: "active",
    salary: employee.salary,
    employee_id: employeeId,
    employee_name: employee.full_name,
    employee_email: employee.email || null,
    company_id: employee.company_id,
    wallet_id: employee.wallet_id,
    wallet_address: employee.wallet_address,
    treasury_wallet_id: employee.treasury_wallet_id
  };

  await executeLoanDisbursement(executionRow, policyResult, auditContext, "rejected");
  return { decision: "approve" as const, loanId: executionRow.id, amount: approvedAmount, interest: approvedInterest, duration: decision.duration, emi, rationale: decision.rationale, autoApproved: true, proofVerified: verification.verified, policy: policyResult };
}

export async function executeApprovedLoan(loanId: string, auditContext: AgentLogContext = {}) {
  await expirePendingReviewLoans();

  const result = await db.query(
    `SELECT
       l.id, l.amount, l.interest_rate, l.duration_months, l.status, e.salary,
       e.id AS employee_id, e.company_id, e.wallet_id, e.full_name AS employee_name,
       COALESCE(e.email, '') AS employee_email, w.wallet_address, c.treasury_wallet_id
     FROM loans l
     JOIN employees e ON e.id = l.employee_id
     JOIN wallets w ON w.id = e.wallet_id
     JOIN companies c ON c.id = e.company_id
     WHERE l.id = $1`,
    [loanId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Loan not found");
  }

  const row = result.rows[0] as LoanExecutionRow;
  if (!["pending", "pending_review"].includes(row.status)) {
    throw new ApiError(400, "Loan is not awaiting approval");
  }

  const policyResult = await evaluateAgentPolicy({
    companyId: row.company_id,
    action: "loan_disbursement",
    amount: parseFloat(row.amount),
    metadata: { employeeId: row.employee_id }
  });

  await logAgentAction(
    "FlowPayPolicyEngine",
    { companyId: row.company_id, employeeId: row.employee_id, loanId, amount: parseFloat(row.amount) },
    { action: "loan_disbursement" },
    policyResult.reasons.join(" ") || "Approved loan execution passed wallet policy checks.",
    `Approved loan policy status: ${policyResult.status.toUpperCase()}`,
    row.company_id,
    { ...auditContext, stage: "policy_validation", policyResult, executionStatus: policyResult.status }
  );

  if (policyResult.status === "block") {
    throw new ApiError(400, policyResult.reasons[0] ?? "Approved loan blocked by policy");
  }

  await ensureEmployeeInitializedOnCore(row.company_id, row.wallet_address, parseFloat(row.salary), 1);
  const transfer = await executeLoanDisbursement(row, policyResult, auditContext, row.status === "pending_review" ? null : "rejected");
  await db.query("UPDATE loans SET status = 'active', updated_at = now() WHERE id = $1", [loanId]);
  return { loanId, status: "active" as const, policy: policyResult, txHash: transfer.txHash ?? null };
}

export async function approvePendingReviewLoan(loanId: string, companyId: string, auditContext: AgentLogContext = {}) {
  const loan = await db.query(
    `SELECT l.id
     FROM loans l
     JOIN employees e ON e.id = l.employee_id
     WHERE l.id = $1 AND e.company_id = $2 AND l.status = 'pending_review'`,
    [loanId, companyId]
  );
  if ((loan.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Pending review loan not found");
  }

  const result = await executeApprovedLoan(loanId, auditContext);
  await syncLoanReviewWorkflowState({
    loanId,
    taskStatus: "approved",
    approvalStatus: "approved",
    decidedBy: "company-review",
    decisionPayload: { source: auditContext.source ?? "company_review" }
  });
  return result;
}

export async function rejectPendingLoan(loanId: string) {
  const result = await db.query(
    `UPDATE loans l
     SET status = 'rejected',
         updated_at = now(),
         review_reason = COALESCE(review_reason, 'Loan request denied')
     FROM employees e
     WHERE l.employee_id = e.id
       AND l.id = $1
       AND l.status IN ('pending', 'pending_review')
     RETURNING l.id, l.amount, l.review_reason, e.company_id, e.id AS employee_id, e.full_name, e.email`,
    [loanId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Pending loan not found");
  }

  const row = result.rows[0];
  await syncLoanReviewWorkflowState({
    loanId,
    taskStatus: "denied",
    approvalStatus: "denied",
    decidedBy: "ops-review",
    decisionPayload: { reason: row.review_reason }
  });
  if (row.email) {
    await sendLoanReviewStatusEmail({
      companyId: row.company_id,
      email: row.email,
      employeeId: row.employee_id,
      employeeName: row.full_name,
      amount: Number(row.amount),
      status: "rejected",
      reason: row.review_reason
    }).catch((error) => {
      console.warn("Failed to send loan rejection email", error);
    });
  }

  return { loanId, status: "rejected" as const };
}
