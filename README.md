# FlowPay

FlowPay is an agentic financial operating system for employers and employees. It combines employer treasury management, employee wallets, payroll, lending, investment routing, and policy-controlled automation into one product surface. The system is designed around a simple idea: financial actions should be automated, but never ungoverned.

At the center of FlowPay is a split-responsibility model:

- `OpenClaw on EC2` handles orchestration and operational reasoning
- `FlowPay backend` enforces policy, permissions, session security, and workflow rules
- `Tether WDK` handles wallet provisioning and transaction execution
- `Sepolia ETH` is the current live testnet settlement rail

This makes FlowPay a product for autonomous financial operations, not just a wallet dashboard.

## Product Vision

FlowPay is built for companies that want treasury and workforce payments to behave like software:

- employer treasury wallets provisioned automatically
- employee wallets created and activated through invitation flows
- payroll executed on-chain
- salary-linked loans disbursed programmatically
- EMI deductions collected during payroll
- idle treasury capital routed into investment flows
- every automation step recorded as a visible audit trail

The product is intentionally structured so that agents can recommend and trigger actions, but they cannot bypass policy or directly control private keys.

## What FlowPay Does

FlowPay brings together five product layers:

1. `Employer treasury operations`
2. `Employee wallet and salary operations`
3. `Loan and repayment workflows`
4. `Agent-driven orchestration`
5. `Policy-controlled wallet execution`

The employer gets a treasury workspace. The employee gets a wallet workspace. The agent layer coordinates allocation, payroll, lending, monitoring, and reserve top-ups. The backend decides what is allowed. The wallet layer executes only approved actions.

## Core Product Capabilities

- Employer onboarding with a managed treasury wallet
- Employee creation, invitation, activation, and password setup
- Company PIN-based access protection
- Employee password-based access protection
- Forgot PIN and forgot password recovery by registered email
- Employer and employee ID delivery through email
- Automated treasury allocation
- Payroll execution with once-per-month employee payout protection
- Salary-linked loan disbursal
- EMI deduction during payroll
- Investment routing with policy constraints
- Reserve-wallet treasury top-ups
- OpenClaw-driven ops automation on EC2
- Audit logs that expose `decision -> policy_validation -> wdk_execution`

## System Architecture

```text
Frontend (Vercel)
  ->
FlowPay Backend API (EC2)
  ->
Policy + Workflow Services
  ->
WDK Wallet Execution
  ->
Sepolia / Contracts / Aave

OpenClaw Gateway + Ops Worker (EC2)
  ->
FlowPay Admin CLI
  ->
FlowPay Backend API
```

The frontend never gets direct wallet authority. Sessions are handled by the backend. OpenClaw does not sign transactions itself. It triggers workflows through FlowPay's controlled execution path.

## Main Product Surfaces

### Employer Workspace

The employer side of FlowPay includes:

- treasury overview
- employees
- payroll
- lending
- investments
- transactions
- admin control
- settings and wallet policy controls

This is where the company sees treasury balance, salary obligations, lending exposure, capital allocation, agent activity, and execution history.

### Employee Workspace

The employee side includes:

- wallet overview
- loan access
- transaction history
- salary receipts
- account settings

Employees do not need raw treasury access. Their workspace is focused on salary, loan proceeds, repayment activity, and wallet visibility.

### Admin Command Surface

FlowPay includes a dedicated admin command layer where operators can:

- trigger OpenClaw strategy runs
- run autonomous demo flows
- view pending ops tasks and approvals
- inspect the agent audit trail
- see the architecture and workflow pipeline in one place

This surface is designed for demos, operations, and judge visibility.

## Full Product Flow

### 1. Employer Onboarding

An employer creates a company in FlowPay. The backend provisions a treasury wallet, stores the wallet under encrypted custody, creates the company record, and secures access behind a company PIN. The company receives its identifying details by email, including its company ID and treasury address.

### 2. Employee Invitation and Activation

An employer adds an employee from the employer workspace. FlowPay creates the employee record, provisions the employee wallet, and sends an invitation email with an activation link. The employee opens the link, sets a password, and activates the account. The email flow also includes the employee ID so future login and recovery are easier.

### 3. Secure Access Model

FlowPay no longer treats a wallet address as authorization. Employer access requires a company PIN. Employee access requires a password. Session authority lives in signed HTTP-only cookies issued by the backend. The browser can hold display context, but it does not hold real wallet authority.

### 4. Treasury Funding

When a treasury wallet receives funds, FlowPay records the treasury balance and makes those funds available for allocation, payroll, lending, and investment workflows. The current live deployment uses native Sepolia ETH for this stage.

### 5. Treasury Allocation

FlowPay applies a fixed treasury split so capital is visible and manageable instead of remaining in one undifferentiated pool.

Current allocation policy:

- `50%` salary treasury
- `20%` lending treasury
- `20%` investment treasury
- `10%` main treasury reserve

This split is reflected in the dashboard, giving employers a clear operational view of salary funding, lending capacity, investment capital, and retained reserve.

### 6. Payroll Execution

Payroll is designed around monthly salary behavior. Each employee should receive salary once per payroll month, not multiple times because the operator clicks the run button again.

FlowPay now:

- records payroll disbursements per employee per month
- marks employees as paid for the current payroll cycle
- excludes already-paid employees from the next payroll run in that same month
- only processes employees who are still due

This ensures payroll behaves like a real operational cycle rather than a raw transfer loop.

### 7. Salary-Linked Loans

Employees can request loans from within their workspace. The loan workflow combines salary context, treasury context, policy rules, and agent reasoning. If the request passes policy validation, FlowPay disburses the approved amount from treasury to employee wallet and records the loan state for future repayment handling.

### 8. EMI Collection

Loan repayment is integrated into payroll. When payroll runs, FlowPay calculates the EMI due for active loans, deducts it from salary, credits the employee with the net amount, and reduces the loan balance accordingly. This ties repayment to the salary cycle and keeps the employee experience predictable.

### 9. Investment Routing

FlowPay can route eligible treasury capital into investment flows while enforcing exposure caps and policy checks. The current product structure supports Aave-style treasury deployment and withdrawal decisions without allowing unconstrained agent execution.

### 10. Reserve Treasury Top-Ups

If a company treasury is short of funds for an operational action, FlowPay can use a configured reserve wallet to top up the treasury. This flow is policy-capped, logged, and routed through the same controlled execution path as the rest of the product.

## OpenClaw on EC2

OpenClaw is a core product component, not an external add-on. In FlowPay, OpenClaw runs on AWS EC2 and acts as the orchestration runtime for operational automation.

OpenClaw responsibilities include:

- running orchestration loops
- dispatching strategy flows
- handling operational tasks
- processing approvals
- triggering treasury top-ups
- supporting the autonomous demo flow
- using the FlowPay skill and admin CLI to interact with the backend safely

OpenClaw does not directly own treasury keys. It reasons and triggers. FlowPay validates. WDK executes.

## Clawbot Automation Model

FlowPay uses the official OpenClaw style of hook-based automation with a FlowPay-specific skill and CLI surface. This allows the clawbot to run wallet and ops workflows without relying on handwritten request sequences.

The clawbot can work across tasks such as:

- payroll approval
- payroll prep
- loan approval
- treasury top-up
- reconciliation
- monitoring alerts
- retry workflows
- admin reports
- browser automation tasks

This makes the live EC2 deployment meaningful as an automation system, not just a static server.

## Policy and Guardrails

FlowPay is intentionally opinionated about safety. Agents can suggest and initiate actions, but they must pass policy checks before any wallet execution occurs.

Policy controls include:

- whether payroll is allowed
- whether loan disbursal is allowed
- whether treasury allocation is allowed
- whether investment rebalancing is allowed
- single-transfer limits
- daily outflow limits
- loan amount caps
- investment exposure caps
- human-review thresholds

This makes FlowPay a constrained agent-finance product, not a free-form autonomous wallet.

## Audit Trail

Every major workflow is written into the product audit trail with staged visibility. The goal is not only to automate, but to make that automation explainable.

Typical stages include:

- `decision`
- `policy_validation`
- `wdk_execution`
- workflow-level success or failure

This gives operators and judges a visible record of what the system decided, what was allowed, and what actually executed on-chain.

## Account Recovery and Identity Support

FlowPay supports recovery for both sides of the product:

- employers can recover access through the registered company email
- employees can recover access through the registered employee email

Recovery flows are built around email-delivered reset links. FlowPay also sends user identifiers through email so employers and employees can recover the correct login context when needed.

## Deployment Model

FlowPay currently runs as a split deployment:

- `Frontend`: Vercel
- `Backend`: AWS EC2
- `OpenClaw gateway and ops worker`: AWS EC2
- `Database`: PostgreSQL on the EC2 host

This deployment reflects the actual product behavior: the public application layer is separate from the operational execution layer, while OpenClaw remains close to the backend and automation services.

## Current Settlement Rail

The live product currently operates on `Sepolia ETH`. This is a testnet execution rail used to validate wallet behavior, treasury movement, payroll, lending, and automation end to end.

The control architecture is intentionally built so the same system can later move to production asset rails without changing the overall product model.

## What Makes FlowPay Different

FlowPay is not only:

- a wallet app
- a payroll dashboard
- a lending page
- an agent demo

It is the combination of those systems into one operating model.

What makes it different is the structure:

- employers and employees each get purpose-built financial workspaces
- treasury is split into visible operational buckets
- payroll, lending, and investment use shared wallet infrastructure
- OpenClaw automates post-onboarding operations on EC2
- the backend remains the real policy authority
- WDK remains the execution layer

That separation is what makes the product automatable without becoming uncontrolled.

## Product Status

FlowPay is currently a live, testnet-based, end-to-end product prototype with:

- deployed employer and employee workspaces
- deployed recovery and invitation flows
- deployed EC2 backend and OpenClaw automation layer
- live treasury, payroll, loan, and reserve top-up workflows
- visible agent audit trail
- monthly payroll protection against duplicate payouts
- fixed treasury allocation visibility on the dashboard

The current live system is already capable of demonstrating a complete employer-to-employee financial operations loop under agent orchestration and policy control.

## FlowPay in One Line

FlowPay is a policy-controlled, OpenClaw-orchestrated financial operating system where treasury, payroll, lending, and wallet execution work together as one product.
