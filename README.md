# FlowPay
FlowPay is an AI-driven treasury and payroll infrastructure for businesses. It provisions a Tether WDK custodial treasury wallet for each company, generates employee wallets, automates payroll with EMI deductions, and routes lending and investment decisions through an OpenClaw-style agent layer. The system is designed to behave like deployable fintech infrastructure, not a prototype.

---

## Core Capabilities

- Company treasury wallets (WDK) on Sepolia for development
- Employee wallet provisioning and activation workflow
- Automated payroll with EMI repayment handling
- Lending workflow with policy validation and agent approval
- Treasury allocation agent for payroll, lending, and investment pools
- Investment agent (ETH market signal simulation)
- Deposit monitoring for treasury funding via WDK Indexer
- WDK pricing (Bitfinex) for ETH snapshots
- WDK Aave lending module integration (supply and withdraw)
- Token transfers (USDT, etc.) via WDK account.transfer
- Multi-chain wallet modules (EVM plus optional TON, TRON, BTC, Solana)
- Frontend dashboard with persistent Company Context and auto-fill

---

## Architecture Overview

```
Frontend (Next.js)
   |
Backend API (Express)
   |
Business Services
   |
Agent Layer (OpenClaw-style)
   |
Wallet Execution (Tether WDK)
   |
Blockchain (Sepolia for dev)
```

Key principle: Agents never touch private keys. Agents only return validated JSON decisions. All signing happens in the backend wallet service.

---

## Repository Layout

```
FlowPay/
  backend/     # Express API, Postgres, agents, WDK wallet service
  frontend/    # Next.js dashboard
  blockchain/  # Hardhat (optional demo deployment)
```

---

## Prerequisites

- Node.js 18+
- PostgreSQL 16 (running in WSL or Windows)
- Sepolia RPC access (Infura/Alchemy/etc.)
- WDK SDK packages installed via npm

---

## Environment Configuration

### Backend (backend/.env)

Minimum required:
```
PORT=4000
DATABASE_URL=postgresql://postgres:1234@<host>:5432/flowpay
RPC_URL=https://sepolia.infura.io/v3/{WDK_API_KEY}
RPC_FALLBACK_URLS=https://sepolia.infura.io/v3/<secondary_project_id>
WDK_API_KEY=...
MASTER_KEY=... (min 32 chars)
ADMIN_SEED_PAYLOAD=... (encrypted admin mnemonic)
VAULT_CONTRACT_ADDRESS=...
LOAN_CONTRACT_ADDRESS=...
```

`RPC_FALLBACK_URLS` accepts a comma-separated list. On EC2, keep your existing primary Sepolia RPC in `RPC_URL` and add the secondary Infura endpoint there so reads and transaction polling can rotate when the primary provider returns `429/5xx`.

Legacy FlowPayInvestment contract (optional): set INVESTMENT_CONTRACT_ADDRESS only if you still use the on-chain wrapper.

Admin seed encryption (generate ADMIN_SEED_PAYLOAD):
```
cd backend
$env:ADMIN_SEED_PHRASE="<12-word mnemonic>"
$env:MASTER_KEY="<same master key you will use in .env>"
npm run admin:encrypt
```
The mnemonic must match the on-chain admin used when deploying FlowPayVault, FlowPayLoan, and FlowPayInvestment, or contract calls will revert.

If your Sepolia contracts were deployed from a raw private key instead of a mnemonic-derived WDK wallet, set `ADMIN_PRIVATE_KEY` in `backend/.env`. The backend will use that signer for contract-admin and Aave treasury actions while keeping the existing WDK wallet flows for company and employee wallets.

WDK Indexer + token mode (stablecoins, on-chain history):
```
WDK_INDEXER_API_KEY=...
WDK_INDEXER_BASE_URL=https://wdk-api.tether.io
TREASURY_TOKEN_SYMBOL=USDT
TREASURY_TOKEN_ADDRESS=...
TREASURY_TOKEN_DECIMALS=6
TREASURY_TOKEN_BLOCKCHAIN=ethereum
```

On EC2, if `OPENCLAW_STRATEGY_ENABLED=true` is already driving orchestration from the worker, set `ORCHESTRATOR_ENABLED=false` in `backend/.env`. That keeps the API process from running a second strategy loop on startup and helps avoid duplicate RPC/indexer load.

For local development, keep `DEPOSIT_WATCHERS_ENABLED=false` and `ORCHESTRATOR_ENABLED=false` unless you are intentionally testing autonomous background loops. That prevents startup from immediately hitting RPC limits or firing agent tasks before your local signer config is ready.

Multi-chain wallets (optional):
```
DEFAULT_CHAIN=ethereum
TON_RPC_URL=
TRON_RPC_URL=
BTC_RPC_URL=
SOLANA_RPC_URL=
```

Aave WDK module (supply token must be configured):
```
AAVE_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
AAVE_WETH_GATEWAY=0xD322A49006FC828F9B5B37Ab215F99B4E5caB19C
AAVE_SUPPLY_TOKEN_ADDRESS=...
AAVE_SUPPLY_TOKEN_DECIMALS=18
AAVE_ATOKEN_ADDRESS=...
AAVE_ATOKEN_DECIMALS=18
WETH_ADDRESS=...
AAVE_WRAP_NATIVE=true
AAVE_UNWRAP_NATIVE=true
MAX_AAVE_EXPOSURE_PCT=0.30
```

Optional (agents and email):
```
LLM_PROVIDER=openai|anthropic|gemini
OPENAI_API_KEY=...
```

Gmail API (invites):
```
EMAIL_PROVIDER_MODE=live
CLAWGENCY_PLATFORM_EMAIL=...
GMAIL_ACCESS_TOKEN=
GMAIL_REPLY_LABEL=flowpay
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/email/oauth/callback
GMAIL_REFRESH_TOKEN_FILE=.secrets/gmail-refresh-token.json
EMAIL_FROM=FlowPay <no-reply@flowpay.local>
```

### Frontend (frontend/.env.local)
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

---

## Database Setup

### If Postgres runs in WSL
1. Start Postgres:
```bash
sudo service postgresql start
```

2. Create DB:
```bash
psql "postgresql://postgres:1234@localhost:5432/postgres" -c "CREATE DATABASE flowpay;"
```

3. Apply schema:
```bash
cd /mnt/c/Users/<you>/OneDrive/Desktop/FlowPay/backend
psql "postgresql://postgres:1234@localhost:5432/flowpay" -f sql/schema.sql
```

### If Backend runs in Windows and Postgres runs in WSL
You must expose Postgres to Windows:
```bash
sudo sed -i "s/^#listen_addresses.*/listen_addresses='*'/" /etc/postgresql/16/main/postgresql.conf
sudo sed -i "s/^listen_addresses.*/listen_addresses='*'/" /etc/postgresql/16/main/postgresql.conf
echo "host all all 0.0.0.0/0 md5" | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
sudo service postgresql restart
```

Then set DATABASE_URL using your WSL IP:
```
DATABASE_URL=postgresql://postgres:1234@<WSL_IP>:5432/flowpay
```

---

## Running the System

### Backend
```bash
cd backend
npm install
npm run dev
# In another terminal (optional but recommended for email-driven OpenClaw ops queue)
npm run ops:worker
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Visit:
- UI: http://localhost:3000
- Health check: http://localhost:4000/health

---

## OpenClaw Automation Layer

FlowPay includes a production-style automation layer wired into `backend/src/schedulers/automationScheduler.ts`.

Automated jobs:
- Scheduled finance ops: daily snapshots, payroll prep, reconciliation reports, end-of-day summaries
- Backend workflows: payroll approval requests, stale ops queue detection, unsynced loan-contract retry queueing
- Blockchain ops: stalled settlement detection, sync-failed investment alerts
- Monitoring and recovery: DB/RPC/price/indexer checks plus watcher re-bootstrap
- Approval workflows: existing payroll + loan approvals remain in `/ops/approvals`
- Admin support: generated digest with “what failed today”, “pending approvals”, and “top risk accounts”
- Browser tasks: queue browser automation tasks from `BROWSER_AUTOMATION_TASKS_JSON`
- Notifications: Slack/Telegram + email task queue alerts for anomalies and important events

Run all automation jobs once:
```bash
cd backend
npm run automation:run
```

Run a single job once:
```bash
npm run automation:run -- monitoring
npm run automation:run -- finance <company-id>
```

---

## Official OpenClaw Clawbot Automation

FlowPay can now use the real `openclaw/openclaw` Gateway on EC2 to replace the human approval loop for wallet operations.

What changed:
- The EC2 ops worker can dispatch pending wallet/ops tasks into the official OpenClaw hook API instead of emailing humans.
- OpenClaw can trigger strategy orchestration runs through the same FlowPay admin surface.
- A local admin CLI is built into FlowPay so the clawbot can approve, deny, complete, and trigger workflows without hand-written curl calls.

Worker env:
```bash
OPENCLAW_AUTOMATE_TASKS=true
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_HOOKS_TOKEN=replace-with-openclaw-hook-token
OPENCLAW_HOOKS_AGENT_ID=
OPENCLAW_HOOK_MODEL=
OPENCLAW_HOOK_THINKING=
OPENCLAW_HOOK_TIMEOUT_SECONDS=180
```

Optional reserve-wallet autofunding:
```bash
RESERVE_TOPUP_ENABLED=true
RESERVE_WALLET_ID=<wallet-id-from-wallets-table>
RESERVE_TOPUP_MAX_AMOUNT=2500
```

Build the admin CLI:
```bash
cd backend
npm run build
npm run flowpay:admin -- task list --status pending
npm run flowpay:admin -- treasury topup --companyId <company-id> --amount 0.25 --reason "payroll shortfall"
```

Install the FlowPay skill into the OpenClaw workspace:
- Use [skills/flowpay-wallet-ops/SKILL.md](/C:/Users/ankur/OneDrive/Desktop/FlowPay/skills/flowpay-wallet-ops/SKILL.md)
- OpenClaw loads workspace skills from `<workspace>/skills`, so either point the OpenClaw workspace at this repo or copy that skill folder into the OpenClaw workspace on EC2
- A starter OpenClaw config is included at [openclaw.flowpay.example.json](/C:/Users/ankur/OneDrive/Desktop/FlowPay/openclaw.flowpay.example.json)

Recommended OpenClaw hook setup:
```json
{
  "hooks": {
    "enabled": true,
    "token": "${OPENCLAW_HOOKS_TOKEN}",
    "path": "/hooks",
    "defaultSessionKey": "hook:flowpay",
    "allowRequestSessionKey": false
  }
}
```

With that setup:
- `OPENCLAW_STRATEGY_ENABLED=true` makes the EC2 worker ask the clawbot to trigger FlowPay strategy runs
- `OPENCLAW_AUTOMATE_TASKS=true` makes the EC2 worker send pending wallet/ops tasks to the clawbot instead of waiting for email replies
- The clawbot uses the local FlowPay admin CLI to approve, deny, complete, orchestrate, or treasury-top-up actions back into FlowPay

Note: with `RESERVE_TOPUP_ENABLED=true`, the clawbot can also fund treasury shortfalls from a configured reserve wallet. Without a reserve wallet, tasks that require outside capital still need a real funding source.

---

## Company Context (Auto-Fill)

Once you register a company, the app stores its context in localStorage and shows it in a Company Context Bar (top of every page):
- Company ID
- Company name
- Treasury address
- One-click copy buttons

This auto-fills the Company ID across all pages (Treasury, Employees, Lending, Payroll).

---

## API Routes

- POST /companies/register
- GET /companies (list)
- GET /companies/:id (details)
- POST /employees/add
- POST /employees/activate
- POST /loans/request
- POST /payroll/run
- GET /treasury/balance?companyId=...
- GET /lending/history?companyId=...
- GET /transactions/onchain?companyId=... (WDK Indexer)
- POST /ops/automation/run (admin master key)
- GET /ops/automation/status (admin master key)
- GET /ops/support/insights?companyId=...&question=... (admin master key)

---

## Wallet Service (WDK)

Implemented in backend/src/services/walletService.ts:

- createTreasuryWallet(companyId)
- createEmployeeWallet(employeeId)
- getWalletBalance(walletId) (Indexer-backed for tokens)
- sendTransaction(fromWalletId, toAddress, amount) (token or native)
- listenForDeposits(walletId) (Indexer-backed for tokens)

Seeds are encrypted at rest using the WDK Secret Manager with MASTER_KEY.

---

## Agent Layer

Located in backend/src/agents/.

Agents return structured JSON and are validated with Zod:

- Loan Agent - approve/reject and terms
- Treasury Allocation Agent - split between payroll/lending/investment
- Investment Agent - ETH market signal simulation

If an agent fails, services fall back to safe defaults.

---

## Payroll Engine

Payroll is triggered on schedule or via API:

1. Fetch employees
2. Calculate EMI from active loans
3. Compute net salary
4. Treasury wallet to employee wallet
5. EMI recorded and loan balances updated

---

## Lending System

Rules enforced before execution:
- Max loan = 2x salary
- Max EMI = 30% salary

Agent decision output must pass validation or request is rejected.

---

## Frontend Pages

- /companies/register - Create a treasury wallet
- /dashboard - Company context and treasury summary
- /treasury/fund - Deposit instructions and copy address
- /employees/new - Employee wallet and activation link
- /employees/activate - Set password (token flow)
- /lending - Lending dashboard
- /payroll - Manual payroll run

---

## Troubleshooting

1) Failed to fetch in UI
- Backend is not running or crashing. Check backend terminal.

2) password authentication failed for user "postgres"
- DATABASE_URL password mismatch or Windows connecting to the wrong Postgres instance.

3) WSL Postgres not reachable from Windows
- Ensure Postgres is listening on 0.0.0.0 and pg_hba.conf allows md5.

4) tsx not recognized
- Run npm install inside backend/.

---

## Security Notes (MVP)

- Private keys never reach the frontend.
- Seeds are encrypted with the WDK Secret Manager using MASTER_KEY.
- Agent outputs are validated before execution.
- Transaction limits are enforced via MAX_TX_AMOUNT.

---

## License

MIT (hackathon MVP).




