import { randomUUID } from "crypto";
import { db } from "../db/pool.js";
import { runOrchestrator } from "../agents/orchestratorAgent.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { ApiError } from "../utils/errors.js";
import { allocateTreasury, getTreasuryBalance } from "./treasuryService.js";
import { requestLoan } from "./loanService.js";
import { runPayroll } from "./payrollService.js";
import { runInvestment } from "./investmentService.js";

type RunStrategyOptions = {
  companyId?: string;
  source?: string;
};

type RunDemoOptions = {
  companyId: string;
  employeeId?: string;
  requestedAmount?: number;
  source?: string;
};

type EligibleEmployee = {
  id: string;
  full_name: string;
  salary: string;
  credit_score: number;
};

function buildAuditContext(
  workflowId: string,
  workflowName: string,
  source: string
): AgentLogContext {
  return {
    workflowId,
    workflowName,
    source
  };
}

function selectDemoLoanAmount(employee: EligibleEmployee, requestedAmount?: number) {
  if (typeof requestedAmount === "number" && Number.isFinite(requestedAmount) && requestedAmount > 0) {
    return requestedAmount;
  }

  const salary = Math.max(parseFloat(employee.salary), 0);
  const baseline = salary * 0.4;
  return parseFloat(Math.max(0.05, Math.min(baseline, 500)).toFixed(4));
}

async function getEligibleDemoEmployee(companyId: string, employeeId?: string) {
  const params: unknown[] = [companyId];
  let employeeClause = "";

  if (employeeId) {
    params.push(employeeId);
    employeeClause = `AND e.id = $${params.length}`;
  }

  const result = await db.query(
    `SELECT e.id, e.full_name, e.salary, e.credit_score
     FROM employees e
     WHERE e.company_id = $1
       ${employeeClause}
       AND e.status = 'active'
       AND e.wallet_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM loans l
         WHERE l.employee_id = e.id
           AND l.status IN ('pending', 'active')
       )
     ORDER BY e.credit_score DESC, e.salary DESC
     LIMIT 1`,
    params
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(400, "No eligible employee available for the autonomous demo");
  }

  return result.rows[0] as EligibleEmployee;
}

export async function runOpenClawStrategy(options: RunStrategyOptions = {}) {
  const source = options.source ?? "openclaw_ec2";
  return runOrchestrator({
    companyId: options.companyId,
    source,
    workflowName: "strategy_orchestration"
  });
}

export async function runAutonomousDemo(options: RunDemoOptions) {
  const source = options.source ?? "admin_demo";
  const workflowId = randomUUID();
  const workflowName = "autonomous_demo";
  const auditContext = buildAuditContext(workflowId, workflowName, source);

  const treasury = await getTreasuryBalance(options.companyId);
  const treasuryBalance = parseFloat(treasury.balance);
  if (!Number.isFinite(treasuryBalance) || treasuryBalance <= 0) {
    throw new ApiError(400, "Treasury must be funded before the autonomous demo can run");
  }

  const employee = await getEligibleDemoEmployee(options.companyId, options.employeeId);
  const loanAmount = selectDemoLoanAmount(employee, options.requestedAmount);

  await logAgentAction(
    "OpenClawOrchestrator",
    {
      companyId: options.companyId,
      source,
      treasuryBalance,
      employeeId: employee.id,
      requestedAmount: loanAmount
    },
    { mode: workflowName },
    "Starting autonomous demo across treasury allocation, lending, payroll, and Aave rebalance.",
    "Autonomous demo started.",
    options.companyId,
    {
      ...auditContext,
      stage: "workflow",
      executionStatus: "started",
      metadata: {
        tokenSymbol: treasury.token_symbol ?? "ETH"
      }
    }
  );

  try {
    const allocation = await allocateTreasury(options.companyId, BigInt(treasury.balanceWei), auditContext);
    const loan = await requestLoan(employee.id, loanAmount, auditContext);
    if (loan.decision !== "approve") {
      throw new ApiError(400, loan.rationale ?? "Autonomous demo loan was not approved");
    }

    const payroll = await runPayroll(options.companyId, auditContext);
    const investment = await runInvestment(options.companyId, auditContext);

    const summary = {
      treasury: {
        balance: treasury.balance,
        tokenSymbol: treasury.token_symbol ?? "ETH",
        walletAddress: treasury.wallet_address ?? null
      },
      employee: {
        id: employee.id,
        fullName: employee.full_name,
        salary: employee.salary,
        creditScore: employee.credit_score
      },
      allocation,
      loan,
      payroll,
      investment
    };

    await logAgentAction(
      "OpenClawOrchestrator",
      summary,
      { mode: workflowName },
      "Autonomous demo completed successfully.",
      "Autonomous demo completed.",
      options.companyId,
      {
        ...auditContext,
        stage: "workflow",
        executionStatus: "success"
      }
    );

    return {
      workflowId,
      workflowName,
      source,
      summary
    };
  } catch (error) {
    await logAgentAction(
      "OpenClawOrchestrator",
      {
        companyId: options.companyId,
        employeeId: employee.id,
        requestedAmount: loanAmount
      },
      { mode: workflowName },
      error instanceof Error ? error.message : "Autonomous demo failed.",
      "Autonomous demo failed.",
      options.companyId,
      {
        ...auditContext,
        stage: "workflow",
        executionStatus: "failed"
      }
    );
    throw error;
  }
}
