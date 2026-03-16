import { z } from "zod";
import { runOpenClawTask } from "./openclaw.js";

const allocationSchema = z.object({
  payroll_reserve_pct: z.number().min(0).max(1),
  lending_pool_pct: z.number().min(0).max(1),
  investment_pool_pct: z.number().min(0).max(1),
  rationale: z.string().min(5)
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
        "You are a senior treasury allocation agent for FlowPay. Your goal is to optimize treasury distribution to ensure payroll is covered while generating yield through lending and investments.\n\n" +
        "Priorities:\n" +
        "1. Payroll Reserve (Primary): Must ensure enough funds are ready for upcoming payroll.\n" +
        "2. Lending Pool (Secondary): Allocate for employee loans based on current loan volume.\n" +
        "3. Investment Pool (Tertiary): Excess capital for yield-bearing assets.\n\n" +
        "Constraint: The percentages MUST sum exactly to 1.0. Respond ONLY with a JSON object.",
      userPrompt: (payload) => 
        `Treasury context: ${JSON.stringify(payload)}.\n\n` +
        "Provide your allocation in JSON format: {\"payroll_reserve_pct\": number, \"lending_pool_pct\": number, \"investment_pool_pct\": number, \"rationale\": \"string\"}",
      schema: allocationSchema,
      temperature: 0.2
    },
    input
  );
}
