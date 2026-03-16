import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";

const allocationSchema = z.object({
  payroll_reserve_pct: z.number().min(0).max(1),
  lending_pool_pct: z.number().min(0).max(1),
  investment_pool_pct: z.number().min(0).max(1)
});

export type TreasuryAllocation = z.infer<typeof allocationSchema>;

export async function runTreasuryAllocationAgent(input: {
  balance: number;
  monthly_payroll: number;
  outstanding_loans: number;
}) {
  return runOpenClawTask<TreasuryAllocation>(
    {
      name: "treasury_allocation",
      systemPrompt:
        "You are a treasury allocation agent. Allocate percentages across payroll reserve, lending pool, and investment pool. Ensure the percentages sum to 1. Respond ONLY with JSON.",
      userPrompt: (payload) =>
        `Treasury context: ${JSON.stringify(payload)}. Return JSON {"payroll_reserve_pct":number,"lending_pool_pct":number,"investment_pool_pct":number}.`,
      schema: allocationSchema,
      temperature: 0.2
    },
    input
  );
}
