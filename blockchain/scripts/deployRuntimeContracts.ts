import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

type RuntimeDeployAddresses = {
  core: string;
  loan: string;
  scoreTierVerifier: string;
  coreDeployTxHash: string;
  loanDeployTxHash: string;
  coreSetLoanTxHash: string;
  scoreTierVerifierDeployTxHash: string;
};

function updateBackendEnv(addresses: RuntimeDeployAddresses) {
  const envPath = path.resolve(process.cwd(), "../backend/.env");
  if (!fs.existsSync(envPath)) {
    console.warn(`backend/.env not found at ${envPath}. Skipping update.`);
    return;
  }

  let content = fs.readFileSync(envPath, "utf8");
  const replaceOrAppend = (key: string, value: string) => {
    const line = `${key}=${value}`;
    if (content.match(new RegExp(`^${key}=.*$`, "m"))) {
      content = content.replace(new RegExp(`^${key}=.*$`, "m"), line);
    } else {
      content += `\n${line}`;
    }
  };

  replaceOrAppend("FLOW_PAY_CORE_ADDRESS", addresses.core);
  replaceOrAppend("FLOW_PAY_LOAN_ADDRESS", addresses.loan);
  replaceOrAppend("SCORE_TIER_VERIFIER_ADDRESS", addresses.scoreTierVerifier);
  replaceOrAppend("FLOW_PAY_CORE_DEPLOY_TX_HASH", addresses.coreDeployTxHash);
  replaceOrAppend("FLOW_PAY_LOAN_DEPLOY_TX_HASH", addresses.loanDeployTxHash);
  replaceOrAppend("FLOW_PAY_CORE_SET_LOAN_TX_HASH", addresses.coreSetLoanTxHash);
  replaceOrAppend("SCORE_TIER_VERIFIER_DEPLOY_TX_HASH", addresses.scoreTierVerifierDeployTxHash);

  const selectedRpcUrl =
    network.name === "mainnet"
      ? process.env.ETHEREUM_RPC_URL || process.env.MAINNET_RPC_URL || process.env.RPC_URL
      : process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
  if (selectedRpcUrl) {
    replaceOrAppend("FLOWPAY_CONTRACT_RPC_URL", selectedRpcUrl);
  }

  fs.writeFileSync(envPath, content);
  console.log("Updated backend/.env with runtime contract addresses.");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = deployer.address;

  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${admin}`);

  const Core = await ethers.getContractFactory("FlowPayCore");
  const core = await Core.deploy(admin);
  await core.waitForDeployment();
  const coreAddress = await core.getAddress();
  const coreDeployTx = core.deploymentTransaction();
  if (!coreDeployTx) {
    throw new Error("Missing deployment transaction for FlowPayCore");
  }
  console.log(`FlowPayCore deployed to ${coreAddress}`);

  const Loan = await ethers.getContractFactory("FlowPayLoan");
  const loan = await Loan.deploy(admin, coreAddress);
  await loan.waitForDeployment();
  const loanAddress = await loan.getAddress();
  const loanDeployTx = loan.deploymentTransaction();
  if (!loanDeployTx) {
    throw new Error("Missing deployment transaction for FlowPayLoan");
  }
  console.log(`FlowPayLoan deployed to ${loanAddress}`);

  const setLoanTx = await core.setLoanContract(loanAddress);
  await setLoanTx.wait();
  console.log(`FlowPayCore wired to FlowPayLoan at ${loanAddress}`);

  const ScoreTierVerifier = await ethers.getContractFactory("ScoreTierVerifier");
  const scoreTierVerifier = await ScoreTierVerifier.deploy(admin);
  await scoreTierVerifier.waitForDeployment();
  const scoreTierVerifierAddress = await scoreTierVerifier.getAddress();
  const verifierDeployTx = scoreTierVerifier.deploymentTransaction();
  if (!verifierDeployTx) {
    throw new Error("Missing deployment transaction for ScoreTierVerifier");
  }
  console.log(`ScoreTierVerifier deployed to ${scoreTierVerifierAddress}`);

  updateBackendEnv({
    core: coreAddress,
    loan: loanAddress,
    scoreTierVerifier: scoreTierVerifierAddress,
    coreDeployTxHash: coreDeployTx.hash,
    loanDeployTxHash: loanDeployTx.hash,
    coreSetLoanTxHash: setLoanTx.hash,
    scoreTierVerifierDeployTxHash: verifierDeployTx.hash
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
