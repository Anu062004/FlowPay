import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("4000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RPC_URL: z.string().min(1, "RPC_URL is required"),
  RPC_FALLBACK_URLS: z.string().optional(),
  WDK_API_KEY: z.string().min(1, "WDK_API_KEY is required"),
  WDK_TRANSFER_MAX_FEE: z.string().default("1000000000000000"),
  WDK_INDEXER_BASE_URL: z.string().default("https://wdk-api.tether.io"),
  WDK_INDEXER_API_KEY: z.string().optional(),
  MASTER_KEY: z.string().min(32, "MASTER_KEY must be at least 32 chars"),
  ADMIN_SEED_PAYLOAD: z.string().optional(),
  ADMIN_PRIVATE_KEY: z.string().optional(),
  DEFAULT_CHAIN: z.string().default("ethereum"),
  TREASURY_TOKEN_SYMBOL: z.string().optional(),
  TREASURY_TOKEN_ADDRESS: z.string().optional(),
  TREASURY_TOKEN_DECIMALS: z.string().default("18"),
  TREASURY_TOKEN_BLOCKCHAIN: z.string().default("ethereum"),
  TON_RPC_URL: z.string().optional(),
  TRON_RPC_URL: z.string().optional(),
  BTC_RPC_URL: z.string().optional(),
  SOLANA_RPC_URL: z.string().optional(),
  LLM_PROVIDER: z.enum(["openai", "anthropic", "gemini"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  INVESTMENT_GEMINI_API_KEY: z.string().optional(),
  INVESTMENT_GEMINI_MODEL: z.string().optional(),
  PAYROLL_CRON: z.string().default("0 9 1 * *"),
  PAYROLL_AUTOMATION_CRON: z.string().default("*/5 * * * *"),
  PAYROLL_AUTOMATION_LOCAL_HOUR: z.string().default("9"),
  PAYROLL_AUTOMATION_LOCAL_MINUTE: z.string().default("0"),
  INVESTMENT_CRON: z.string().default("0 */6 * * *"),
  REPORT_CRON: z.string().default("0 9 * * 1"),
  FINANCE_DAILY_CRON: z.string().default("0 8 * * *"),
  RECONCILIATION_CRON: z.string().default("0 */4 * * *"),
  BACKEND_WORKFLOW_CRON: z.string().default("*/20 * * * *"),
  BLOCKCHAIN_MONITOR_CRON: z.string().default("*/15 * * * *"),
  HEALTH_MONITOR_CRON: z.string().default("*/5 * * * *"),
  ADMIN_SUPPORT_CRON: z.string().default("0 */6 * * *"),
  BROWSER_AUTOMATION_CRON: z.string().default("30 */6 * * *"),
  PAYROLL_PREP_LOOKAHEAD_HOURS: z.string().default("72"),
  AUTOMATION_DEDUPE_WINDOW_MIN: z.string().default("240"),
  BLOCKCHAIN_STALLED_TX_MIN: z.string().default("30"),
  OPS_ALERT_COOLDOWN_MIN: z.string().default("30"),
  OPS_SLACK_WEBHOOK_URL: z.string().optional(),
  OPS_TELEGRAM_BOT_TOKEN: z.string().optional(),
  OPS_TELEGRAM_CHAT_ID: z.string().optional(),
  OPS_NOTIFICATION_EMAILS: z.string().optional(),
  BROWSER_AUTOMATION_TASKS_JSON: z.string().optional(),
  MAX_TX_AMOUNT: z.string().default("100000"),
  RESERVE_TOPUP_ENABLED: z.string().default("false"),
  RESERVE_WALLET_ID: z.string().uuid().optional(),
  RESERVE_TOPUP_MAX_AMOUNT: z.string().default("2500"),
  TREASURY_PAYROLL_RESERVE_PCT: z.string().default("0.6"),
  TREASURY_LENDING_PCT: z.string().default("0.2"),
  TREASURY_INVESTMENT_PCT: z.string().default("0.2"),
  PRICE_API_URL: z.string().optional(),
  PRICE_API_KEY: z.string().optional(),
  CMC_API_KEY: z.string().optional(),
  CMC_API_URL: z.string().optional(),
  CMC_LISTINGS_URL: z.string().optional(),
  INVESTMENT_WALLET_ADDRESS: z.string().optional(),
  EMAIL_PROVIDER_MODE: z.string().optional(),
  CLAWGENCY_PLATFORM_EMAIL: z.string().optional(),
  GMAIL_ACCESS_TOKEN: z.string().optional(),
  GMAIL_REPLY_LABEL: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REDIRECT_URI: z.string().optional(),
  GMAIL_REFRESH_TOKEN_FILE: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_REDIRECT_URI: z.string().optional(),
  GMAIL_SENDER_EMAIL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  HUMAN_TASKS_PROVIDER: z.enum(["local", "openclaw"]).default("local"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  FLOW_PAY_CORE_ADDRESS: z.string().optional(),
  VAULT_CONTRACT_ADDRESS: z.string().optional(),
  FLOW_PAY_LOAN_ADDRESS: z.string().optional(),
  LOAN_CONTRACT_ADDRESS: z.string().optional(),
  DEPOSIT_WATCHERS_ENABLED: z.string().default(isProduction ? "true" : "false"),
  ORCHESTRATOR_ENABLED: z.string().default(isProduction ? "true" : "false"),
  ORCHESTRATOR_INTERVAL_MS: z.string().default("120000"),
  FLOW_PAY_INVESTMENT_ADDRESS: z.string().optional(),
  INVESTMENT_CONTRACT_ADDRESS: z.string().optional(),
  AAVE_POOL_ADDRESS: z.string().default("0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951"),
  AAVE_WETH_GATEWAY: z.string().default("0xD322A49006FC828F9B5B37Ab215F99B4E5caB19C"),
  AAVE_SUPPLY_TOKEN_ADDRESS: z.string().optional(),
  AAVE_SUPPLY_TOKEN_DECIMALS: z.string().default("18"),
  AAVE_ATOKEN_ADDRESS: z.string().optional(),
  AAVE_ATOKEN_DECIMALS: z.string().default("18"),
  WETH_ADDRESS: z.string().optional(),
  AAVE_WRAP_NATIVE: z.string().default("true"),
  AAVE_UNWRAP_NATIVE: z.string().default("true"),
  MAX_AAVE_EXPOSURE_PCT: z.string().default("0.30"),
  LOAN_AUTO_APPROVAL_THRESHOLD: z.string().default("0.02")
});

const parsedEnv = envSchema.parse(process.env);
const coreContractAddress =
  parsedEnv.FLOW_PAY_CORE_ADDRESS?.trim() || parsedEnv.VAULT_CONTRACT_ADDRESS?.trim();
const loanContractAddress =
  parsedEnv.FLOW_PAY_LOAN_ADDRESS?.trim() || parsedEnv.LOAN_CONTRACT_ADDRESS?.trim();
const investmentContractAddress =
  parsedEnv.FLOW_PAY_INVESTMENT_ADDRESS?.trim() || parsedEnv.INVESTMENT_CONTRACT_ADDRESS?.trim();

if (!coreContractAddress) {
  throw new Error("FLOW_PAY_CORE_ADDRESS is required");
}

if (!loanContractAddress) {
  throw new Error("FLOW_PAY_LOAN_ADDRESS is required");
}

export const env = {
  ...parsedEnv,
  CORE_CONTRACT_ADDRESS: coreContractAddress,
  LOAN_CONTRACT_ADDRESS: loanContractAddress,
  INVESTMENT_CONTRACT_ADDRESS: investmentContractAddress
};
