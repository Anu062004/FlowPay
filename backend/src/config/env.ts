import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("4000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RPC_URL: z.string().min(1, "RPC_URL is required"),
  WDK_API_KEY: z.string().min(1, "WDK_API_KEY is required"),
  WDK_TRANSFER_MAX_FEE: z.string().default("1000000000000000"),
  MASTER_KEY: z.string().min(32, "MASTER_KEY must be at least 32 chars"),
  LLM_PROVIDER: z.enum(["openai", "anthropic", "gemini"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-1.5-pro"),
  PAYROLL_CRON: z.string().default("0 9 1 * *"),
  INVESTMENT_CRON: z.string().default("0 */6 * * *"),
  MAX_TX_AMOUNT: z.string().default("100000"),
  TREASURY_PAYROLL_RESERVE_PCT: z.string().default("0.6"),
  TREASURY_LENDING_PCT: z.string().default("0.2"),
  TREASURY_INVESTMENT_PCT: z.string().default("0.2"),
  PRICE_API_URL: z.string().optional(),
  PRICE_API_KEY: z.string().optional(),
  CMC_API_KEY: z.string().optional(),
  CMC_API_URL: z.string().optional(),
  CMC_LISTINGS_URL: z.string().optional(),
  INVESTMENT_WALLET_ADDRESS: z.string().optional(),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  PRIVATE_KEY: z.string().min(1, "PRIVATE_KEY is required"),
  VAULT_CONTRACT_ADDRESS: z.string().min(1, "VAULT_CONTRACT_ADDRESS is required"),
  LOAN_CONTRACT_ADDRESS: z.string().min(1, "LOAN_CONTRACT_ADDRESS is required"),
  ORCHESTRATOR_INTERVAL_MS: z.string().default("120000"),
  INVESTMENT_CONTRACT_ADDRESS: z.string().min(1, "Investment contract address required"),
  AAVE_POOL_ADDRESS: z.string().default("0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951"),
  AAVE_WETH_GATEWAY: z.string().default("0xD322A49006FC828F9B5B37Ab215F99B4E5caB19C"),
  MAX_AAVE_EXPOSURE_PCT: z.string().default("0.30")
});

export const env = envSchema.parse(process.env);
