import { execFile } from "child_process";
import fs from "fs";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import path from "path";
import { promisify } from "util";
import { computeEmployeeCommit, employeeAddressToField, textToField } from "./poseidon.js";

export type ScoreTierProofInput = {
  employeeAddr: string;
  actualScore: number;
  tierMin: number;
  tierMax: number;
  companySalt: string;
};

export type ScoreTierSolidityCalldata = {
  raw: string;
  pA: [string, string];
  pB: [[string, string], [string, string]];
  pC: [string, string];
  pubSignals: [string, string, string, string];
};

export type ScoreTierProofOutput = {
  proof: Record<string, unknown>;
  publicSignals: string[];
  solidityCalldata: ScoreTierSolidityCalldata;
};

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const snarkjsCliPath = path.join(path.dirname(require.resolve("snarkjs")), "cli.cjs");

function getCircuitsDir() {
  return path.resolve(process.cwd(), "circuits");
}

function getWasmPath() {
  const buildPath = path.join(getCircuitsDir(), "build", "ScoreTierProof_js", "ScoreTierProof.wasm");
  if (fs.existsSync(buildPath)) {
    return buildPath;
  }
  return path.join(getCircuitsDir(), "ScoreTierProof_js", "ScoreTierProof.wasm");
}

function getZkeyPath() {
  const buildPath = path.join(getCircuitsDir(), "build", "score_tier_final.zkey");
  if (fs.existsSync(buildPath)) {
    return buildPath;
  }
  return path.join(getCircuitsDir(), "score_tier_final.zkey");
}

function getRuntimeArtifactsDir() {
  const runtimeDir = path.join(getCircuitsDir(), ".runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  return runtimeDir;
}

function parseSolidityCallData(raw: string): ScoreTierSolidityCalldata {
  const parsed = JSON.parse(`[${raw}]`) as [
    [string, string],
    [[string, string], [string, string]],
    [string, string],
    [string, string, string, string]
  ];

  return {
    raw,
    pA: parsed[0],
    pB: parsed[1],
    pC: parsed[2],
    pubSignals: parsed[3]
  };
}

async function runSnarkjs(args: string[]) {
  try {
    return await execFileAsync(process.execPath, [snarkjsCliPath, ...args], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    const execError = error as Error & { stdout?: string; stderr?: string };
    const details = [execError.stderr, execError.stdout].find((value) => value && value.trim());
    throw new Error(
      details
        ? `snarkjs ${args.join(" ")} failed: ${details.trim()}`
        : `snarkjs ${args.join(" ")} failed`
    );
  }
}

export async function generateTierProof(input: ScoreTierProofInput): Promise<ScoreTierProofOutput> {
  if (input.actualScore < 450) {
    throw new Error("ScoreTierProof requires an actual score of at least 450");
  }

  const employeeCommit = await computeEmployeeCommit(input.employeeAddr, input.companySalt);
  const witnessInput = {
    actualScore: input.actualScore.toString(),
    salt: textToField(input.companySalt).toString(),
    employeeAddress: employeeAddressToField(input.employeeAddr).toString(),
    tierMin: input.tierMin.toString(),
    tierMax: input.tierMax.toString(),
    employeeCommit: employeeCommit.toString()
  };

  const runtimeDir = getRuntimeArtifactsDir();
  const requestId = randomUUID();
  const inputPath = path.join(runtimeDir, `score-tier-${requestId}.input.json`);
  const witnessPath = path.join(runtimeDir, `score-tier-${requestId}.wtns`);
  const proofPath = path.join(runtimeDir, `score-tier-${requestId}.proof.json`);
  const publicSignalsPath = path.join(runtimeDir, `score-tier-${requestId}.public.json`);

  let proof: Record<string, unknown>;
  let publicSignals: string[];
  let rawCalldata = "";
  try {
    fs.writeFileSync(inputPath, JSON.stringify(witnessInput));

    await runSnarkjs(["wtns", "calculate", getWasmPath(), inputPath, witnessPath]);
    await runSnarkjs(["groth16", "prove", getZkeyPath(), witnessPath, proofPath, publicSignalsPath]);

    const calldataResult = await runSnarkjs([
      "zkey",
      "export",
      "soliditycalldata",
      publicSignalsPath,
      proofPath
    ]);

    proof = JSON.parse(fs.readFileSync(proofPath, "utf8")) as Record<string, unknown>;
    publicSignals = JSON.parse(fs.readFileSync(publicSignalsPath, "utf8")) as string[];
    rawCalldata = calldataResult.stdout.trim();
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(witnessPath, { force: true });
    fs.rmSync(proofPath, { force: true });
    fs.rmSync(publicSignalsPath, { force: true });
  }

  return {
    proof,
    publicSignals,
    solidityCalldata: parseSolidityCallData(rawCalldata)
  };
}
