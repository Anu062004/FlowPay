---
name: flowpay-wallet-ops
description: Automate FlowPay wallet operations by using the local FlowPay admin CLI to resolve approvals, complete ops tasks, and trigger orchestration.
metadata: {"openclaw":{"os":["linux"],"requires":{"bins":["node"]}}}
user-invocable: false
---

You are operating FlowPay on the same EC2 host as the backend.

Use the FlowPay admin CLI instead of inventing raw API calls. The default CLI path on EC2 is:

`node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js`

If the environment variable `FLOWPAY_ADMIN_CLI` exists, prefer:

`node "$FLOWPAY_ADMIN_CLI"`

Available commands:

- List pending tasks:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js task list --status pending`
- Complete a task:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js task complete --id <taskId>`
- List pending approvals:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js approval list --status pending`
- Approve an approval:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js approval approve --id <approvalId> --decidedBy openclaw-gateway --reason "<short reason>"`
- Deny an approval:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js approval deny --id <approvalId> --decidedBy openclaw-gateway --reason "<short reason>"`
- Trigger strategy orchestration:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js orchestration run --mode strategy --source openclaw_clawbot`
- Trigger demo orchestration:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js orchestration run --mode demo --companyId <companyId> --source openclaw_clawbot`
- Trigger a reserve-wallet treasury top-up:
  `node /opt/flowpay/backend/dist/tools/flowpayAdminCli.js treasury topup --companyId <companyId> --amount <amount> --reason "<short reason>" --source openclaw_clawbot [--taskId <taskId>]`

FlowPay operating rules:

- Never ask a human for routine wallet approvals.
- If a task contains an `approval_id`, you must resolve it with either `approve` or `deny`.
- For `payroll_approval`, deny when `shortfall > 0`. Approve when treasury coverage is sufficient and there is no explicit blocking issue.
- For `loan_approval`, approve only when the payload/rationale is internally consistent and there is no blocking signal. Deny when uncertain.
- For `payroll_prep`, `finance_snapshot`, `reconciliation_report`, `eod_summary`, `settlement_alert`, `monitoring_alert`, `workflow_retry`, `admin_report`, `notification_alert`, and `support_ticket`, review the payload, act if needed, then mark the task completed.
- For `treasury_topup`, use the local treasury top-up CLI command when reserve-wallet autofunding is configured, then mark the task completed.
- For `browser_automation`, use OpenClaw's browser tool with the provided URL and instructions, then mark the task completed in FlowPay.
- For `contract_approval` or `kyc_request`, deny when you cannot verify the payload from the host.
- If a task requires external capital injection or any action you cannot actually perform on the host, do not fabricate success. State the blocker clearly.
- Keep summaries short and factual.
