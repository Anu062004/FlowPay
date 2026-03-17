---
name: flowpay-ops
description: Pulls FlowPay /ops tasks, sends approval emails via Gmail, and auto-approves/denies based on email replies.
---

# FlowPay Ops (OpenClaw)

This skill polls the FlowPay backend for pending ops tasks, sends approval emails to admins or employees, and processes inbound replies to auto-approve or deny requests.

## Prereqs
- FlowPay backend reachable at `FLOWPAY_API_URL`
- `MASTER_KEY` set (used for `/ops` auth)
- Gmail OAuth env vars configured (same as FlowPay backend)
- Admin emails configured in `ADMIN_EMAILS`

## Run once
```bash
cd backend
npx tsx scripts/openclawOpsWorker.ts --once
```

## Run continuously
```bash
cd backend
npx tsx scripts/openclawOpsWorker.ts
```

## Reply format
Replies must contain **APPROVE** or **DENY**. The approval id is embedded in the subject line:
```
[FlowPay Approval:<uuid>] Action required
```
