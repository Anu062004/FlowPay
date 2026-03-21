import { db } from "../db/pool.js";
import { getEthPrice } from "./priceService.js";
import { runInvestmentAgent } from "../agents/investmentAgent.js";
import { env } from "../config/env.js";
import { depositToAave, getATokenBalance, getYieldEarned, withdrawFromAave } from "./aaveService.js";
import { logAgentAction, type AgentLogContext } from "./agentLogService.js";
import { evaluateAgentPolicy } from "./agentPolicyService.js";
import { formatTokenAmount, parseTokenAmount } from "../utils/amounts.js";

function toFixedNum(value: number): number {
  return parseFloat(value.toFixed(6));
}

export async function runInvestment(companyId: string, auditContext: AgentLogContext = {}) {
  const allocationResult = await db.query(
    `SELECT investment_pool, payroll_reserve, lending_pool, main_reserve
     FROM treasury_allocations
     WHERE company_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [companyId]
  );

  const investmentPool = allocationResult.rowCount
    ? parseFloat(allocationResult.rows[0].investment_pool)
    : 0;

  let atokenBalance = 0;
  let yieldEarned = 0;
  let aaveUnavailableReason: string | null = null;
  try {
    atokenBalance = await getATokenBalance(companyId);
    yieldEarned = await getYieldEarned(companyId);
  } catch (error) {
    aaveUnavailableReason = error instanceof Error ? error.message : "Aave unavailable";
  }
  const activePositionsResult = await db.query(
    "SELECT COUNT(*) AS count FROM investment_positions WHERE company_id = $1 AND status = 'active'",
    [companyId]
  );
  const openPositions = parseInt(activePositionsResult.rows[0].count, 10);
  const priceInfo = await getEthPrice();

  const agentInput = {
    balance: investmentPool,
    investment_pool: investmentPool,
    eth_price: priceInfo.price,
    price_change_pct: priceInfo.changePct,
    atoken_balance: atokenBalance,
    yield_earned: yieldEarned,
    open_positions: openPositions
  };

  const decision = await runInvestmentAgent(agentInput).catch((error) => ({
    decision: "hold" as const,
    allocation_pct: 0,
    rationale: `Agent fallback: ${error instanceof Error ? error.message : "investment agent unavailable"}`
  }));

  await logAgentAction(
    "InvestmentAgent",
    agentInput,
    decision,
    decision.rationale,
    decision.decision === "invest"
      ? `Proposed Aave allocation of ${(decision.allocation_pct * 100).toFixed(1)}%`
      : decision.decision === "withdraw"
        ? "Proposed Aave withdrawal"
        : "Proposed hold on investment pool",
    companyId,
    {
      ...auditContext,
      stage: "decision"
    }
  );

  if (aaveUnavailableReason) {
    const fallbackDecision = {
      decision: "hold" as const,
      allocation_pct: 0,
      rationale: `Aave unavailable: ${aaveUnavailableReason}`
    };
    await logAgentAction(
      "InvestmentAgent",
      agentInput,
      fallbackDecision,
      fallbackDecision.rationale,
      "Skipped investment execution because Aave context was unavailable.",
      companyId
      ,
      {
        ...auditContext,
        stage: "wdk_execution",
        executionStatus: "skipped"
      }
    );
    return { ...fallbackDecision, invested_amount: 0, txHash: null };
  }

  if (decision.decision === "invest" && decision.allocation_pct > 0) {
    const investAmount = investmentPool * decision.allocation_pct;
    const aaveDecimals = parseInt(env.AAVE_SUPPLY_TOKEN_DECIMALS, 10);
    let investAmountRaw = 0n;
    let normalizedInvestAmount = 0;
    if (Number.isFinite(investAmount) && investAmount > 0) {
      investAmountRaw = parseTokenAmount(investAmount.toFixed(aaveDecimals), aaveDecimals);
      normalizedInvestAmount = parseFloat(formatTokenAmount(investAmountRaw, aaveDecimals));
    }
    const payrollReserve = parseFloat(allocationResult.rows[0]?.payroll_reserve ?? "0");
    const lendingPool = parseFloat(allocationResult.rows[0]?.lending_pool ?? "0");
    const mainReserve = parseFloat(allocationResult.rows[0]?.main_reserve ?? "0");
    const totalTreasury = investmentPool + payrollReserve + lendingPool + mainReserve;
    const maxExposure = totalTreasury * parseFloat(env.MAX_AAVE_EXPOSURE_PCT);

    if (investAmountRaw <= 0n || normalizedInvestAmount <= 0) {
      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        "Skipped invest because the computed allocation rounded down to zero.",
        "Investment execution skipped because the computed deposit amount was zero.",
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          executionStatus: "skipped"
        }
      );
      return { ...decision, invested_amount: 0, txHash: null };
    }

    const policyResult = await evaluateAgentPolicy({
      companyId,
      action: "aave_rebalance",
      amount: normalizedInvestAmount,
      metadata: {
        allocationPct: decision.allocation_pct * 100,
        currentTreasuryBalance: totalTreasury
      }
    });

    await logAgentAction(
      "FlowPayPolicyEngine",
      {
        companyId,
        investAmount: normalizedInvestAmount,
        allocationPct: decision.allocation_pct * 100,
        totalTreasury
      },
      {
        action: "aave_rebalance"
      },
      policyResult.reasons.join(" ") || "Investment action passed wallet policy checks.",
      `Investment policy status: ${policyResult.status.toUpperCase()}`,
      companyId,
      {
        ...auditContext,
        stage: "policy_validation",
        policyResult,
        executionStatus: policyResult.status
      }
    );

    if (policyResult.status === "block") {
      return { ...decision, invested_amount: 0, txHash: null, policy: policyResult };
    }

    if (atokenBalance + normalizedInvestAmount > maxExposure) {
      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        "Blocked by exposure cap",
        `Skipped invest. Exposure cap ${maxExposure.toFixed(6)} ETH would be exceeded.`,
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          policyResult,
          executionStatus: "blocked"
        }
      );
      return { ...decision, invested_amount: 0, txHash: null, policy: policyResult };
    }

    try {
      const txHash = await depositToAave(companyId, normalizedInvestAmount);
      const updatedATokenBalance = await getATokenBalance(companyId);
      const updatedYieldEarned = await getYieldEarned(companyId);

      await db.query(
        `INSERT INTO investment_positions
         (company_id, amount_deposited, atoken_balance, yield_earned, entry_price, tx_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
        [
          companyId,
          toFixedNum(normalizedInvestAmount),
          toFixedNum(updatedATokenBalance),
          toFixedNum(updatedYieldEarned),
          toFixedNum(priceInfo.price),
          txHash
        ]
      );

      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        decision.rationale,
        `Invested ${normalizedInvestAmount.toFixed(6)} ETH into Aave V3. Tx: ${txHash}`,
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          policyResult,
          executionStatus: "success",
          metadata: {
            txHash
          }
        }
      );

      return { ...decision, invested_amount: normalizedInvestAmount, txHash, policy: policyResult };
    } catch (error) {
      await logAgentAction(
        "InvestmentAgent",
        agentInput,
        decision,
        error instanceof Error ? error.message : "Aave deposit failed.",
        `Investment execution failed for ${normalizedInvestAmount.toFixed(6)} ETH.`,
        companyId,
        {
          ...auditContext,
          stage: "wdk_execution",
          policyResult,
          executionStatus: "failed"
        }
      );
      throw error;
    }
  }

  const activePositionsDetail = await db.query(
    "SELECT id, amount_deposited, entry_price FROM investment_positions WHERE company_id = $1 AND status = 'active' ORDER BY opened_at ASC",
    [companyId]
  );

  if (decision.decision === "withdraw" && (activePositionsDetail.rowCount ?? 0) > 0) {
    for (const pos of activePositionsDetail.rows) {
      const withdrawAmount = parseFloat(pos.amount_deposited);
      try {
        const txHash = await withdrawFromAave(companyId, withdrawAmount);
        await db.query(
          "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
          [pos.id]
        );
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          decision.rationale,
          `Withdrew ${withdrawAmount.toFixed(6)} ETH from Aave on withdraw decision. Tx: ${txHash}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "success",
            metadata: {
              txHash
            }
          }
        );
      } catch (error) {
        await db.query("UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1", [pos.id]);
        const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          errorMessage,
          `WITHDRAWAL_FAILED for ${withdrawAmount.toFixed(6)} ETH on position ${pos.id}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "failed"
          }
        );
      }
    }
  }

  if (decision.decision === "hold" && (activePositionsDetail.rowCount ?? 0) > 0) {
    for (const pos of activePositionsDetail.rows) {
      const entryPrice = parseFloat(pos.entry_price);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
        continue;
      }
      const priceDropPct = ((entryPrice - priceInfo.price) / entryPrice) * 100;
      if (priceDropPct <= 15) {
        continue;
      }

      const withdrawAmount = parseFloat(pos.amount_deposited);
      try {
        const txHash = await withdrawFromAave(companyId, withdrawAmount);
        await db.query(
          "UPDATE investment_positions SET status = 'closed', closed_at = now() WHERE id = $1",
          [pos.id]
        );
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          decision.rationale,
          `Hold-mode stop loss triggered (${priceDropPct.toFixed(2)}% drop). Withdrew ${withdrawAmount.toFixed(6)} ETH. Tx: ${txHash}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "success",
            metadata: {
              txHash
            }
          }
        );
      } catch (error) {
        await db.query("UPDATE investment_positions SET status = 'sync_failed' WHERE id = $1", [pos.id]);
        const errorMessage = error instanceof Error ? error.message : "Unknown withdrawal error";
        await logAgentAction(
          "InvestmentAgent",
          agentInput,
          decision,
          errorMessage,
          `WITHDRAWAL_FAILED during hold stop-loss for ${withdrawAmount.toFixed(6)} ETH on position ${pos.id}`,
          companyId,
          {
            ...auditContext,
            stage: "wdk_execution",
            executionStatus: "failed"
          }
        );
      }
    }
  }

  return decision;
}
