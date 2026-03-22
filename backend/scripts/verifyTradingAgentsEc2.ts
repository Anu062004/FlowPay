import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

type AwsJson = Record<string, unknown> | Array<unknown>;

type InstanceInfo = {
  instanceId: string;
  name: string;
  publicIp?: string;
  privateIp?: string;
};

type SendCommandResponse = {
  Command?: {
    CommandId?: string;
  };
};

type InvocationResponse = {
  Status?: string;
  StandardOutputContent?: string;
  StandardErrorContent?: string;
};

function readOption(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function shellSingleQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildAwsEnv() {
  const env = { ...process.env };
  delete env.HTTP_PROXY;
  delete env.HTTPS_PROXY;
  delete env.http_proxy;
  delete env.https_proxy;
  return env;
}

function runAws(args: string[]) {
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    env: buildAwsEnv()
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(stderr || stdout || `aws ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result.stdout;
}

function runAwsJson<T extends AwsJson>(args: string[]) {
  const output = runAws(args);
  return JSON.parse(output) as T;
}

function resolveInstance(region: string, instanceId?: string, instanceName = "flowpay-openclaw") {
  if (instanceId) {
    const response = runAwsJson<Array<Array<{
      InstanceId: string;
      Name?: string;
      PublicIP?: string;
      PrivateIP?: string;
    }>>>([
      "ec2",
      "describe-instances",
      "--region",
      region,
      "--instance-ids",
      instanceId,
      "--query",
      "Reservations[*].Instances[*].{InstanceId:InstanceId,Name:Tags[?Key=='Name']|[0].Value,PublicIP:PublicIpAddress,PrivateIP:PrivateIpAddress}",
      "--output",
      "json"
    ]);

    const instance = response.flat().find(Boolean);
    if (!instance) {
      throw new Error(`No EC2 instance found for instance id ${instanceId}`);
    }

    return {
      instanceId: instance.InstanceId,
      name: instance.Name ?? instanceName,
      publicIp: instance.PublicIP,
      privateIp: instance.PrivateIP
    } satisfies InstanceInfo;
  }

  const response = runAwsJson<Array<Array<{
    InstanceId: string;
    Name?: string;
    PublicIP?: string;
    PrivateIP?: string;
  }>>>([
    "ec2",
    "describe-instances",
    "--region",
    region,
    "--filters",
    `Name=tag:Name,Values=${instanceName}`,
    "Name=instance-state-name,Values=running",
    "--query",
    "Reservations[*].Instances[*].{InstanceId:InstanceId,Name:Tags[?Key=='Name']|[0].Value,PublicIP:PublicIpAddress,PrivateIP:PrivateIpAddress}",
    "--output",
    "json"
  ]);

  const instance = response.flat().find(Boolean);
  if (!instance) {
    throw new Error(`No running EC2 instance found with Name tag ${instanceName}`);
  }

  return {
    instanceId: instance.InstanceId,
    name: instance.Name ?? instanceName,
    publicIp: instance.PublicIP,
    privateIp: instance.PrivateIP
  } satisfies InstanceInfo;
}

function buildRemoteNodeCommand(backendDir: string, capitalUsdc: number) {
  const script =
    "const baseUrl = process.env.TRADING_AGENTS_URL;" +
    "const secret = process.env.TRADING_AGENTS_SECRET;" +
    "const timeoutMs = Number(process.env.TRADING_AGENTS_TIMEOUT_MS || '300000');" +
    "if (!baseUrl || !secret) { throw new Error('TRADING_AGENTS_URL and TRADING_AGENTS_SECRET must be configured on the EC2 host'); }" +
    "const healthResponse = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });" +
    "if (!healthResponse.ok) { throw new Error(`TradingAgents health check failed with status ${healthResponse.status}`); }" +
    "const health = await healthResponse.json();" +
    `const analyzeResponse = await fetch(\`\${baseUrl}/analyze\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capital_usdc: ${capitalUsdc}, horizon: '30d', api_secret: secret, current_allocation: {} }), signal: AbortSignal.timeout(timeoutMs) });` +
    "if (!analyzeResponse.ok) { throw new Error(`TradingAgents analyze request failed with status ${analyzeResponse.status}: ${await analyzeResponse.text()}`); }" +
    "const decision = await analyzeResponse.json();" +
    "console.log(JSON.stringify({" +
    "trading_agents_url: baseUrl," +
    "trading_agents_timeout_ms: String(timeoutMs)," +
    "health," +
    "decision: {" +
    "action: decision.action," +
    "confidence: decision.confidence," +
    "model_used: decision.model_used," +
    "allocation: decision.allocation" +
    "}" +
    "}, null, 2));";

  return [
    "set -eu",
    `cd ${shellSingleQuote(backendDir)}`,
    "test -f .env && echo env_file_present=yes",
    "if [ -f dist/clients/tradingAgentsClient.js ]; then echo trading_agents_client_present=yes; else echo trading_agents_client_present=no; fi",
    "echo backend_dir=$(pwd)",
    "echo node_version=$(node -v)",
    "TRADING_AGENTS_URL=$(grep '^TRADING_AGENTS_URL=' .env | cut -d= -f2-)",
    "TRADING_AGENTS_SECRET=$(grep '^TRADING_AGENTS_SECRET=' .env | cut -d= -f2-)",
    "TRADING_AGENTS_TIMEOUT_MS=$(grep '^TRADING_AGENTS_TIMEOUT_MS=' .env | cut -d= -f2-)",
    "export TRADING_AGENTS_URL TRADING_AGENTS_SECRET TRADING_AGENTS_TIMEOUT_MS",
    "echo trading_agents_url=$TRADING_AGENTS_URL",
    "echo trading_agents_timeout_ms=${TRADING_AGENTS_TIMEOUT_MS:-unset}",
    "node --input-type=module -e " + shellSingleQuote(script)
  ];
}

function buildRemoteNodeCommandWithOverrides(input: {
  backendDir: string;
  capitalUsdc: number;
  tradingAgentsUrl?: string;
  tradingAgentsSecret?: string;
  tradingAgentsTimeoutMs?: string;
}) {
  const script =
    "const baseUrl = process.env.TRADING_AGENTS_URL;" +
    "const secret = process.env.TRADING_AGENTS_SECRET;" +
    "const timeoutMs = Number(process.env.TRADING_AGENTS_TIMEOUT_MS || '300000');" +
    "if (!baseUrl || !secret) { throw new Error('TRADING_AGENTS_URL and TRADING_AGENTS_SECRET must be configured on the EC2 host'); }" +
    "const healthResponse = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });" +
    "if (!healthResponse.ok) { throw new Error(`TradingAgents health check failed with status ${healthResponse.status}`); }" +
    "const health = await healthResponse.json();" +
    `const analyzeResponse = await fetch(\`\${baseUrl}/analyze\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capital_usdc: ${input.capitalUsdc}, horizon: '30d', api_secret: secret, current_allocation: {} }), signal: AbortSignal.timeout(timeoutMs) });` +
    "if (!analyzeResponse.ok) { throw new Error(`TradingAgents analyze request failed with status ${analyzeResponse.status}: ${await analyzeResponse.text()}`); }" +
    "const decision = await analyzeResponse.json();" +
    "console.log(JSON.stringify({" +
    "trading_agents_url: baseUrl," +
    "trading_agents_timeout_ms: String(timeoutMs)," +
    "health," +
    "decision: {" +
    "action: decision.action," +
    "confidence: decision.confidence," +
    "model_used: decision.model_used," +
    "allocation: decision.allocation" +
    "}" +
    "}, null, 2));";

  const commands = [
    "set -eu",
    `cd ${shellSingleQuote(input.backendDir)}`,
    "echo backend_dir=$(pwd)",
    "echo node_version=$(node -v)"
  ];

  if (input.tradingAgentsUrl) {
    commands.push(`TRADING_AGENTS_URL=${shellSingleQuote(input.tradingAgentsUrl)}`);
  } else {
    commands.push("TRADING_AGENTS_URL=$(grep '^TRADING_AGENTS_URL=' .env | cut -d= -f2-)");
  }

  if (input.tradingAgentsSecret) {
    commands.push(`TRADING_AGENTS_SECRET=${shellSingleQuote(input.tradingAgentsSecret)}`);
  } else {
    commands.push("TRADING_AGENTS_SECRET=$(grep '^TRADING_AGENTS_SECRET=' .env | cut -d= -f2-)");
  }

  if (input.tradingAgentsTimeoutMs) {
    commands.push(`TRADING_AGENTS_TIMEOUT_MS=${shellSingleQuote(input.tradingAgentsTimeoutMs)}`);
  } else {
    commands.push("TRADING_AGENTS_TIMEOUT_MS=$(grep '^TRADING_AGENTS_TIMEOUT_MS=' .env | cut -d= -f2-)");
  }

  commands.push("export TRADING_AGENTS_URL TRADING_AGENTS_SECRET TRADING_AGENTS_TIMEOUT_MS");
  commands.push("echo trading_agents_url=$TRADING_AGENTS_URL");
  commands.push("echo trading_agents_timeout_ms=${TRADING_AGENTS_TIMEOUT_MS:-unset}");
  commands.push("node --input-type=module -e " + shellSingleQuote(script));

  return commands;
}

function sendVerificationCommand(region: string, instanceId: string, commands: string[]) {
  const response = runAwsJson<SendCommandResponse>([
    "ssm",
    "send-command",
    "--region",
    region,
    "--instance-ids",
    instanceId,
    "--document-name",
    "AWS-RunShellScript",
    "--comment",
    "FlowPay TradingAgents verification",
    "--parameters",
    JSON.stringify({ commands }),
    "--output",
    "json"
  ]);

  const commandId = response.Command?.CommandId;
  if (!commandId) {
    throw new Error("AWS SSM send-command did not return a command id");
  }
  return commandId;
}

async function waitForInvocation(region: string, commandId: string, instanceId: string) {
  const terminal = new Set(["Success", "Failed", "Cancelled", "TimedOut", "Cancelling"]);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = runAwsJson<InvocationResponse>([
      "ssm",
      "get-command-invocation",
      "--region",
      region,
      "--command-id",
      commandId,
      "--instance-id",
      instanceId,
      "--output",
      "json"
    ]);

    const status = response.Status ?? "Unknown";
    if (terminal.has(status)) {
      return response;
    }

    await delay(5000);
  }

  throw new Error(`Timed out waiting for SSM command ${commandId}`);
}

async function main() {
  const region = readOption("region") ?? process.env.FLOWPAY_EC2_REGION ?? "ap-south-1";
  const instanceId = readOption("instance-id") ?? process.env.FLOWPAY_EC2_INSTANCE_ID;
  const instanceName = readOption("instance-name") ?? process.env.FLOWPAY_EC2_INSTANCE_NAME ?? "flowpay-openclaw";
  const backendDir = readOption("backend-dir") ?? process.env.FLOWPAY_EC2_BACKEND_DIR ?? "/opt/flowpay/backend";
  const capitalUsdc = parseFloat(readOption("capital-usdc") ?? process.env.FLOWPAY_TRADING_AGENTS_TEST_CAPITAL_USDC ?? "100");
  const tradingAgentsUrl = readOption("trading-agents-url") ?? process.env.TRADING_AGENTS_URL;
  const tradingAgentsSecret = readOption("trading-agents-secret") ?? process.env.TRADING_AGENTS_SECRET;
  const tradingAgentsTimeoutMs = readOption("trading-agents-timeout-ms") ?? process.env.TRADING_AGENTS_TIMEOUT_MS;

  if (!Number.isFinite(capitalUsdc) || capitalUsdc <= 0) {
    throw new Error("capital-usdc must be a positive number");
  }

  const instance = resolveInstance(region, instanceId, instanceName);
  const commands = buildRemoteNodeCommandWithOverrides({
    backendDir,
    capitalUsdc,
    tradingAgentsUrl,
    tradingAgentsSecret,
    tradingAgentsTimeoutMs
  });
  const commandId = sendVerificationCommand(region, instance.instanceId, commands);
  const invocation = await waitForInvocation(region, commandId, instance.instanceId);

  const output = {
    region,
    instance,
    commandId,
    status: invocation.Status ?? "Unknown",
    stdout: invocation.StandardOutputContent?.trim() ?? "",
    stderr: invocation.StandardErrorContent?.trim() ?? ""
  };

  console.log(JSON.stringify(output, null, 2));

  if (invocation.Status !== "Success") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
