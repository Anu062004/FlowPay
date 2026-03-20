import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

type Json = Record<string, unknown>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = process.env.FLOWPAY_BACKEND_ROOT ?? path.resolve(__dirname, "../..");
const envFile = process.env.FLOWPAY_ENV_FILE ?? path.join(backendRoot, ".env");

dotenv.config({ path: envFile });

const baseUrl = (process.env.FLOWPAY_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? "4000"}`).replace(/\/+$/, "");
const masterKey = process.env.FLOWPAY_MASTER_KEY ?? process.env.MASTER_KEY ?? "";

function usage() {
  console.error(
    [
      "Usage:",
      "  flowpayAdminCli task list [--status pending] [--companyId <uuid>] [--type <taskType>]",
      "  flowpayAdminCli task complete --id <taskId>",
      "  flowpayAdminCli approval list [--status pending] [--companyId <uuid>]",
      "  flowpayAdminCli approval approve --id <approvalId> [--decidedBy <label>] [--reason <text>]",
      "  flowpayAdminCli approval deny --id <approvalId> [--decidedBy <label>] [--reason <text>]",
      "  flowpayAdminCli orchestration run --mode strategy|demo [--companyId <uuid>] [--employeeId <uuid>] [--requestedAmount <num>] [--source <label>]",
      "  flowpayAdminCli treasury topup --companyId <uuid> --amount <num> [--reason <text>] [--source <label>] [--taskId <uuid>]"
    ].join("\n")
  );
}

function fail(message: string): never {
  throw new Error(message);
}

function readOption(args: string[], name: string) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for --${name}`);
  }
  return value;
}

function readRequiredOption(args: string[], name: string) {
  return readOption(args, name) ?? fail(`--${name} is required`);
}

async function flowpayFetch(pathname: string, init?: RequestInit) {
  if (!masterKey) {
    fail("MASTER_KEY or FLOWPAY_MASTER_KEY is required");
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      "x-master-key": masterKey,
      ...(init?.headers ?? {})
    },
    ...init
  });

  const text = await response.text();
  let data: unknown = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as Record<string, unknown>).error)
        : `FlowPay API request failed (${response.status})`;
    fail(message);
  }

  return data;
}

async function runTaskCommand(action: string, args: string[]) {
  if (action === "list") {
    const search = new URLSearchParams();
    if (readOption(args, "status")) search.set("status", readOption(args, "status")!);
    if (readOption(args, "companyId")) search.set("companyId", readOption(args, "companyId")!);
    if (readOption(args, "type")) search.set("type", readOption(args, "type")!);
    return flowpayFetch(`/ops/tasks${search.toString() ? `?${search.toString()}` : ""}`);
  }

  if (action === "complete") {
    const id = readRequiredOption(args, "id");
    return flowpayFetch(`/ops/tasks/${id}/complete`, { method: "POST" });
  }

  fail(`Unsupported task action: ${action}`);
}

async function runApprovalCommand(action: string, args: string[]) {
  if (action === "list") {
    const search = new URLSearchParams();
    if (readOption(args, "status")) search.set("status", readOption(args, "status")!);
    if (readOption(args, "companyId")) search.set("companyId", readOption(args, "companyId")!);
    return flowpayFetch(`/ops/approvals${search.toString() ? `?${search.toString()}` : ""}`);
  }

  if (action === "approve" || action === "deny") {
    const id = readRequiredOption(args, "id");
    const decidedBy = readOption(args, "decidedBy") ?? "openclaw-gateway";
    const reason = readOption(args, "reason");
    const decisionPayload: Json = {
      source: "openclaw_gateway",
      automated: true
    };
    if (reason) {
      decisionPayload.reason = reason;
    }

    return flowpayFetch(`/ops/approvals/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify({
        decidedBy,
        decisionPayload
      })
    });
  }

  fail(`Unsupported approval action: ${action}`);
}

async function runOrchestrationCommand(action: string, args: string[]) {
  if (action !== "run") {
    fail(`Unsupported orchestration action: ${action}`);
  }

  const mode = readOption(args, "mode") ?? "strategy";
  const companyId = readOption(args, "companyId");
  const employeeId = readOption(args, "employeeId");
  const requestedAmountRaw = readOption(args, "requestedAmount");
  const requestedAmount =
    requestedAmountRaw !== undefined ? Number.parseFloat(requestedAmountRaw) : undefined;
  const source = readOption(args, "source") ?? "openclaw_clawbot";

  if (mode === "demo" && !companyId) {
    fail("--companyId is required when --mode demo");
  }

  return flowpayFetch("/ops/orchestration/run", {
    method: "POST",
    body: JSON.stringify({
      mode,
      companyId,
      employeeId,
      requestedAmount,
      source
    })
  });
}

async function runTreasuryCommand(action: string, args: string[]) {
  if (action !== "topup") {
    fail(`Unsupported treasury action: ${action}`);
  }

  const companyId = readRequiredOption(args, "companyId");
  const amountRaw = readRequiredOption(args, "amount");
  const amount = Number.parseFloat(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    fail("--amount must be a positive number");
  }

  return flowpayFetch("/ops/treasury/topup", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      amount,
      reason: readOption(args, "reason"),
      source: readOption(args, "source") ?? "openclaw_clawbot",
      taskId: readOption(args, "taskId")
    })
  });
}

async function main() {
  const args = process.argv.slice(2);
  const area = args[0];
  const action = args[1];
  const rest = args.slice(2);

  if (!area || !action) {
    usage();
    process.exitCode = 1;
    return;
  }

  let result: unknown;
  if (area === "task") {
    result = await runTaskCommand(action, rest);
  } else if (area === "approval") {
    result = await runApprovalCommand(action, rest);
  } else if (area === "orchestration") {
    result = await runOrchestrationCommand(action, rest);
  } else if (area === "treasury") {
    result = await runTreasuryCommand(action, rest);
  } else {
    usage();
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
