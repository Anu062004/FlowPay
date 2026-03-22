import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..");
const workspaceDir = path.resolve(backendDir, "..");
const circuitsDir = path.join(backendDir, "circuits");
const buildDir = path.join(circuitsDir, "build");
const sourceCircuit = path.join(circuitsDir, "ScoreTierProof.circom");
const generatedJsDir = path.join(circuitsDir, "ScoreTierProof_js");
const buildJsDir = path.join(buildDir, "ScoreTierProof_js");

function canRun(command) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function resolveCompiler() {
  const candidates = [
    process.env.CIRCOM_BIN,
    path.join(workspaceDir, ".codex_tmp", "circom.exe"),
    path.join(backendDir, ".codex_tmp", "circom.exe"),
    process.platform === "win32" ? "circom.exe" : "circom",
    "circom"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (canRun(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Unable to find a native Circom compiler for WASM generation.",
      "Set CIRCOM_BIN to a Circom executable path or place the official binary at .codex_tmp/circom.exe."
    ].join(" ")
  );
}

function copyDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function main() {
  const compiler = resolveCompiler();
  fs.mkdirSync(buildDir, { recursive: true });

  console.log(`Using Circom compiler: ${compiler}`);
  execFileSync(compiler, [sourceCircuit, "--wasm", "-o", circuitsDir], {
    stdio: "inherit",
    windowsHide: true
  });

  if (!fs.existsSync(path.join(generatedJsDir, "ScoreTierProof.wasm"))) {
    throw new Error(`Circom did not generate ${path.join(generatedJsDir, "ScoreTierProof.wasm")}`);
  }

  copyDirectoryContents(generatedJsDir, buildJsDir);
  console.log(`WASM bundle copied to ${buildJsDir}`);
}

main();
