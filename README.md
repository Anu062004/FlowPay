# FlowPay

**A policy-controlled financial operating system for treasury, payroll, employee wallets, lending, and agent-driven finance.**

FlowPay treats treasury, payroll, employee financial access, salary-linked credit, and operational automation as one coordinated system, not a collection of disconnected tools.

## What We Built

Most finance automation tools automate interfaces. FlowPay automates workflows with real USDT, real wallets, and real policy enforcement at every step.

- Employers get a treasury workspace: capital allocation, payroll reserves, lending pools, investment routing, and full audit visibility.
- Employees get a wallet and salary workspace: salary receipts in USDT, loan access tied to salary, and transaction history.
- Agents through OpenClaw reason, recommend, and trigger operations, but never bypass policy or directly control treasury execution.
- The backend is the policy authority. Always.

## Core Architecture

<p align="center">
  <img src="docs/flowpay-architecture-diagram.svg" alt="FlowPay current-state architecture diagram" width="100%" />
</p>

The separation of responsibilities is intentional and non-negotiable:

- OpenClaw reasons, coordinates, and triggers.
- FlowPay backend validates policy, scope, sessions, and workflow rules.
- Tether WDK provisions wallets and executes USDT transactions.
- PostgreSQL stores business state and full audit history.

Agents do not hold treasury keys. Browsers do not sign treasury actions. Every execution passes through backend policy checks.

## How It Works

Every major action in FlowPay follows the same execution pattern:

`DECISION -> POLICY CHECK -> WDK EXECUTION -> AUDIT RECORD`

An agent, workflow, or operator proposes an action. The backend checks caps, permissions, and exposure thresholds. If allowed, WDK executes the USDT transaction. Everything is written to the audit trail.

This makes the system inspectable, not just functional.

## Product Flows

### Employer Onboarding

The company is created, a treasury wallet is provisioned server-side via WDK, and the employer workspace is activated. Wallet custody is encrypted and managed entirely server-side.

### Employee Wallets

The employer invites an employee, FlowPay provisions a USDT wallet, and the employee activates through the invitation flow. Workforce identity, salary, and wallet access are linked from day one.

### Treasury Allocation

Treasury is split into structured operational buckets:

- `Salary Reserve`: funds committed to upcoming payroll.
- `Lending Pool`: capital available for salary-linked loans.
- `Investment Pool`: capital routed through investment workflows.
- `Retained Reserve`: operational buffer.

Capital is visible and purposeful, not one undifferentiated balance.

### Payroll Execution

Backend scope checks run first, then wallet policy validation, then USDT salary transfers through WDK, and finally disbursements are recorded per cycle. Payroll behaves like a real operating cycle, not a raw transfer function.

### Salary-Linked Loans

An employee requests a loan. FlowPay combines salary data, repayment history, and OpenClaw agent reasoning, then runs a backend policy check before any USDT disbursal happens through the treasury execution path. Agents inform the decision; policy enforces it.

### EMI Collection

Loan repayments are tied to payroll. When payroll runs, EMI deductions are collected in the same cycle so lending and payroll operate as one system, not separate modules.

### Investment Routing

OpenClaw analyzes treasury posture and recommends allocation, the backend applies policy checks, and controlled WDK execution carries out the approved movement. Agents advise; humans and policy decide.

### Reserve Top-Ups

When treasury falls short for an operational action, a configured reserve wallet tops up the treasury under bounded policy rules, creating a closed loop between monitoring, automation, and execution.

## Safety Model

| Control | How FlowPay Handles It |
| --- | --- |
| Agents do not hold treasury keys | OpenClaw triggers workflows while WDK executes server-side. |
| No browser-side signing | All wallet execution is backend-only. |
| Transfer caps | Per-wallet and per-company limits are enforced at the policy layer. |
| Daily outflow limits | Outbound movement is bounded by configurable company controls. |
| Human review thresholds | High-value actions can require manual approval. |
| Session security | Signed HTTP-only cookies secure employer and employee sessions. |
| Wallet custody | Seed material is encrypted and stored server-side. |
| Full audit trail | Decision, policy, execution, and outcome are recorded end to end. |

## OpenClaw

OpenClaw runs on EC2 and acts as the operational brain of FlowPay. It is used to:

- trigger orchestration and workflow runs
- process ops tasks and approval queues
- drive autonomous demo flows
- provide agent reasoning for loan and investment decisions
- support admin and scheduling workflows through a controlled CLI and backend surface

OpenClaw is allowed to reason, coordinate, and trigger.

It is not allowed to bypass backend controls or directly own treasury execution.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 14, React, TypeScript, Tailwind |
| Backend | Express, TypeScript, Zod |
| Database | PostgreSQL |
| Wallet Execution | Tether WDK for USDT wallet and transaction execution |
| Agent Automation | OpenClaw on EC2 |
| AI Adapters | OpenAI, Anthropic, Gemini |
| Blockchain | Hardhat, Solidity, EVM-compatible contracts |
| Proof Layer | zk score-tier proof generation and verifier |

## Demo

The full product loop in one sequence:

1. Onboard a company and provision the treasury wallet, then fund it with USDT.
2. Invite employees and activate their wallets.
3. Allocate treasury into operational buckets.
4. Have an employee request a salary-linked loan while OpenClaw reasons, policy approves, and USDT is disbursed.
5. Run payroll and collect EMI deduction in the same cycle.
6. Inspect the full audit trail from decision to policy check to WDK execution.
7. Trigger OpenClaw from the command deck and watch autonomous operations run end to end.

## Repository

```text
frontend/     Next.js employer, employee, and command-deck UI
backend/      Express API, policy engine, schedulers, wallet execution, automation
blockchain/   Solidity contracts, Hardhat config, deploy scripts
skills/       OpenClaw skills for FlowPay operations
```

FlowPay is a financial operating system where treasury, payroll, lending, investment routing, employee access, and agent automation are treated as one coordinated product: programmable, agent-assisted, and firmly governed.
