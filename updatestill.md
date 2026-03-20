# FlowPay Update Status

Last updated: March 20, 2026

## 1. Current Project Summary

FlowPay is now running as an agentic treasury, lending, payroll, and wallet-automation prototype built around:

- a Next.js frontend
- an Express/TypeScript backend
- PostgreSQL for business state
- Tether WDK for wallet creation and transaction execution
- OpenClaw running on AWS EC2 as the orchestration and task-automation agent
- Sepolia ETH as the current live testnet settlement rail

The system has moved from a manual, loosely protected prototype to a backend-authenticated, policy-checked, agent-driven workflow where OpenClaw on EC2 can automate most post-onboarding operational wallet actions.

## 2. What Has Been Implemented So Far

### Security and Access Hardening

- Dashboard access is no longer unlocked just by entering a wallet address.
- Company sessions now require backend-authenticated sign-in with a company PIN.
- Employee sessions now require backend-authenticated sign-in with a password.
- Protected APIs use signed HTTP-only cookies instead of trusting raw IDs from the browser.
- Company settings now expose wallet-policy controls and agent guardrails.

### Agent and Automation Layer

- Treasury allocation, loan decisions, payroll execution, investment execution, and orchestration all write structured agent logs.
- Every major workflow is split into:
  - `decision`
  - `policy_validation`
  - `wdk_execution`
  - workflow-level success/failure logging
- OpenClaw on EC2 now drives orchestration through the official OpenClaw gateway hook path.
- A FlowPay-specific OpenClaw skill is installed so the clawbot can operate FlowPay from the EC2 host.
- A local FlowPay admin CLI exists so OpenClaw can act safely without handwritten curl commands.

### Infrastructure and Reliability

- RPC failover was added for Sepolia reads and polling.
- Retry handling was added for transient RPC failures.
- Indexer fallback was added so treasury balance reads can fall back to direct RPC.
- Duplicate orchestration loops on EC2 were removed by favoring the OpenClaw worker as the active strategy driver.
- EC2 deployment was updated to use OpenAI as the active LLM provider.
- Admin-chain execution was patched to support `ADMIN_PRIVATE_KEY` where needed.

### OpenClaw-Driven Reserve Top-Ups

- A reserve-wallet top-up path was added so OpenClaw can resolve treasury shortfalls from a configured reserve wallet.
- This flow is now deployed on EC2.
- The live EC2 environment is currently capped at:
  - `RESERVE_TOPUP_MAX_AMOUNT=0.05`
- The reserve wallet was generated and configured on EC2.

## 3. System Architecture

### Frontend

The frontend is a Next.js app that exposes:

- company onboarding and sign-in
- employee onboarding and activation
- treasury, lending, payroll, investment, and admin views
- an audit/activity feed for agent actions
- admin controls for:
  - OpenClaw strategy runs
  - autonomous demo runs
  - workflow/audit visibility
  - architecture and execution trace display

### Backend

The backend is the main control plane. It is responsible for:

- authentication and session issuance
- validation and authorization
- database state changes
- policy evaluation
- WDK wallet provisioning
- WDK transaction execution
- contract sync
- deposit watching
- orchestration endpoints
- agent logging

### Database

PostgreSQL stores:

- companies
- employees
- wallets
- loans
- transactions
- treasury allocations
- company settings
- ops tasks
- ops approvals
- agent logs

### WDK Execution Layer

WDK is used for:

- treasury wallet creation
- employee wallet creation
- native/token balance checks
- payroll transfers
- loan disbursals
- treasury transfers
- reserve-wallet transfers
- on-chain transaction signing and execution

### OpenClaw on EC2

OpenClaw on EC2 is the agent runtime and orchestration entrypoint.

It does not replace the backend or WDK. Instead it sits above them:

`OpenClaw on EC2 -> FlowPay admin CLI -> FlowPay backend policy layer -> WDK -> Sepolia`

## 4. What OpenClaw Is Doing on EC2

OpenClaw on EC2 is now the active agent runtime for operational automation.

### OpenClaw responsibilities

- receives task/orchestration prompts through the OpenClaw gateway hook API
- uses the FlowPay OpenClaw skill installed in the OpenClaw workspace
- runs the local FlowPay admin CLI on the EC2 host
- triggers strategy orchestration runs
- resolves pending ops tasks
- resolves approval tasks
- can launch the autonomous demo workflow
- can perform reserve-wallet treasury top-ups when allowed by backend policy
- can process browser automation tasks when provided with browser instructions

### FlowPay admin CLI responsibilities

The CLI gives OpenClaw a safe control surface for:

- listing tasks
- completing tasks
- listing approvals
- approving/denying approvals
- triggering orchestration
- triggering treasury top-ups

This keeps OpenClaw from having to construct raw API requests manually.

### OpenClaw task types currently routed for automation

The EC2 worker can now send the following task families into OpenClaw:

- `payroll_approval`
- `loan_approval`
- `payroll_prep`
- `treasury_topup`
- `browser_automation`
- `finance_snapshot`
- `reconciliation_report`
- `eod_summary`
- `settlement_alert`
- `monitoring_alert`
- `workflow_retry`
- `notification_alert`
- `kyc_request`
- `contract_approval`
- `support_ticket`
- `admin_report`

### What OpenClaw does not fully automate

OpenClaw does not fully replace human input for:

- initial company registration
- initial employee registration
- employee activation/password setup
- external identity checks not available on-host
- external funding outside the configured reserve wallet
- actions requiring credentials or systems not exposed to the EC2 agent

## 5. End-to-End Flows

### A. Company Onboarding Flow

1. Employer registers a company through the frontend.
2. Backend creates the company record.
3. Backend creates a treasury wallet using WDK.
4. The wallet seed is encrypted and stored in the `wallets` table.
5. The company is linked to that treasury wallet.
6. Company sign-in is protected by backend auth and a company PIN.

### B. Employee Onboarding Flow

1. Employer adds an employee, or an employee registers.
2. Backend creates the employee record.
3. Backend creates the employee wallet using WDK.
4. Backend stores the encrypted wallet seed.
5. Employee activation or password setup completes the account.
6. Employee sign-in is protected by backend auth and password validation.

### C. Treasury Funding Flow

1. A treasury wallet receives Sepolia ETH.
2. Deposit monitoring or balance checks detect the funds.
3. Backend records the deposit in transactions/history.
4. Treasury balance becomes available to downstream flows like allocation, lending, payroll, and investment.

### D. OpenClaw Strategy Flow

1. OpenClaw on EC2 is triggered by the worker loop or admin action.
2. The worker dispatches a hook request into the official OpenClaw gateway.
3. OpenClaw uses the FlowPay skill.
4. OpenClaw calls the local admin CLI.
5. CLI calls the backend orchestration endpoint.
6. Backend runs the orchestrator logic.
7. Strategy logs are written to the audit trail.

### E. Treasury Allocation Flow

1. Treasury balance is loaded from the backend.
2. The treasury allocation agent proposes reserve/lending/investment percentages.
3. The backend policy layer validates the action.
4. Allocation is stored in the database.
5. Vault/contract sync is attempted.
6. Agent logs capture:
   - decision
   - policy validation
   - WDK/chain execution result

### F. Loan Request and Disbursal Flow

1. Employee requests a loan.
2. Backend gathers salary, score, treasury context, and risk context.
3. The loan agent decides approve/reject and loan terms.
4. Backend applies policy checks:
   - max transfer
   - daily outflow
   - max loan amount
   - human-review threshold
5. If not blocked, backend creates the loan row.
6. Treasury wallet sends funds to employee wallet via WDK.
7. Contract sync is attempted.
8. Logs are written for the full decision path.

### G. Payroll Flow

1. Payroll run is requested or scheduled.
2. Backend calculates each employee’s salary and EMI deductions.
3. Backend evaluates payroll policy against company wallet settings.
4. If allowed, treasury wallet pays net salary to employee wallets.
5. EMI repayments are mirrored into transaction history.
6. Loan balances are updated.
7. Logs capture policy and execution stages.

### H. EMI Collection Flow

EMI collection currently happens as part of payroll:

1. Payroll computes outstanding EMI for active loans.
2. EMI is deducted from salary.
3. Transaction rows are written for EMI repayment.
4. Loan balances are reduced accordingly.

### I. Investment / Aave Rebalance Flow

1. Treasury allocation determines the investment pool.
2. The investment agent decides whether to invest, hold, or skip.
3. Backend applies policy checks:
   - max exposure
   - max transfer
   - daily outflow
4. If allowed, backend executes Aave deposit/withdraw logic.
5. Investment positions and logs are updated.

### J. Reserve Treasury Top-Up Flow

This is the newest fully deployed wallet-automation path.

1. A treasury shortfall exists or a top-up is requested.
2. OpenClaw can trigger the treasury-top-up command through the FlowPay admin CLI.
3. Backend validates:
   - reserve top-up is enabled
   - reserve wallet is configured
   - amount is below the configured cap
   - reserve wallet has enough balance
4. If allowed, WDK sends funds from the reserve wallet to the company treasury wallet.
5. Agent logs are written under the `reserve_treasury_topup` workflow.

### K. Autonomous Demo Flow

The autonomous demo is the clearest judge-facing end-to-end flow:

1. Treasury must be funded.
2. OpenClaw triggers the autonomous demo.
3. Backend picks an eligible employee.
4. Treasury allocation runs.
5. Loan approval/disbursal runs.
6. Payroll runs and collects EMI.
7. Investment rebalance runs.
8. Audit logs show the whole execution path.

## 6. Audit Trail and Judge Visibility

The UI now exposes a visible agent audit trail so judges can see:

- agent name
- workflow id
- workflow name
- stage
- source
- rationale
- action taken
- policy result
- execution status

This provides a readable `decision -> policy_validation -> wdk_execution` path instead of a black-box automation claim.

## 7. Company Wallet Policy Controls

Company settings now expose wallet guardrails including:

- allow/disallow treasury allocation
- allow/disallow loan disbursal
- allow/disallow payroll
- allow/disallow Aave rebalance
- max single transfer
- max daily outflow
- max loan amount
- max Aave exposure
- human-review threshold

These settings make the system safer and judge-friendly because the agent is constrained by backend policy, not given unlimited wallet authority.

## 8. Current EC2 Deployment Status

As of March 20, 2026:

- the EC2 instance is running
- backend service is active
- OpenClaw gateway service is active
- ops worker service is active
- the OpenClaw worker is enabled
- strategy automation is enabled
- task automation is enabled
- reserve top-ups are enabled
- the reserve top-up cap is set to `0.05 ETH`
- the deployed settlement rail is native Sepolia ETH

### Current live reserve wallet

- reserve wallet id: `c8f1f87d-d6d3-48d8-b8a9-68f40df3b781`
- reserve wallet address: `0x1a447e6B60de11F81D6759Dde9f19A17368Ae037`

### Live verification already performed

A real reserve top-up smoke test succeeded on EC2 in native ETH mode:

- company: `68826de2-f096-47f1-a08e-c058cc69c497`
- top-up amount: `0.001 ETH`
- tx hash: `0xbfcdbbe1710ab541c33ade95574bffff3f4a4f346a57ffe84f8f51ccce66e742`

This confirms that:

- OpenClaw-related reserve-topup code is deployed
- the EC2 backend is using ETH mode
- the reserve wallet path is working
- WDK execution succeeded on-chain

## 9. Important Reality Check

The system is strongly automated after onboarding, but not every human-facing lifecycle step is eliminated.

### Already automated well

- wallet provisioning
- treasury management flows
- payroll execution
- loan execution
- reserve top-ups
- strategy orchestration
- reporting/monitoring/retry tasks
- browser automation tasks when instructions exist

### Still partially manual or external

- initial company and employee registration
- employee activation credentials
- external capital injection beyond reserve limits
- identity/kyc actions that need external verification
- any off-platform system that OpenClaw has not been explicitly connected to

## 10. Why the Project Fits the Hackathon Direction

The project now has a credible story for:

- agent wallets
- autonomous treasury management
- autonomous lending decisions
- policy-constrained financial agents
- clear separation of:
  - OpenClaw reasoning/orchestration
  - backend policy control
  - WDK wallet execution

Current testnet semantics are:

- native Sepolia ETH for live testing

Planned future production semantics can still be:

- USDt
- USAf
- XAUt
- other real settlement assets

The architecture already supports that transition later. The current ETH mode is only the active testnet rail.

## 11. Main Files to Know

### Backend

- `backend/src/index.ts`
- `backend/scripts/openclawOpsWorker.ts`
- `backend/src/tools/flowpayAdminCli.ts`
- `backend/src/services/orchestrationService.ts`
- `backend/src/services/treasuryService.ts`
- `backend/src/services/loanService.ts`
- `backend/src/services/payrollService.ts`
- `backend/src/services/investmentService.ts`
- `backend/src/services/walletService.ts`
- `backend/src/services/agentPolicyService.ts`
- `backend/src/services/agentLogService.ts`
- `backend/src/routes/opsRoutes.ts`
- `backend/src/config/env.ts`

### Frontend

- `frontend/app/page.tsx`
- `frontend/app/admin/page.tsx`
- `frontend/app/settings/page.tsx`
- `frontend/app/components/AgentActivityFeed.tsx`
- `frontend/app/lib/api.ts`

### OpenClaw

- `skills/flowpay-wallet-ops/SKILL.md`
- `openclaw.flowpay.example.json`

## 12. Next Logical Improvements

- automate more onboarding steps if desired
- connect OpenClaw to richer browser workflows
- add better human override dashboards for exceptional cases
- move from native ETH testing to target stable/test assets when ready
- add richer queue management for stale or blocked ops tasks
- expand external-system automation only where credentials and permissions are safe

## 13. Bottom-Line Status

FlowPay is now a deployed EC2-based OpenClaw + WDK agent-finance prototype where:

- OpenClaw on EC2 is the active orchestration layer
- backend policy controls every financial action
- WDK executes wallet operations
- audit logs show the full reasoning and execution path
- native Sepolia ETH is the current live settlement rail
- reserve treasury top-ups are live and verified on-chain

For post-onboarding wallet operations, the prototype is now meaningfully automated end to end.
