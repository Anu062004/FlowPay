import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

function updateBackendEnv(addresses: {
  core: string;
  loan: string;
  investment: string;
  scoreTierVerifier: string;
  coreDeployTxHash: string;
  loanDeployTxHash: string;
  coreSetLoanTxHash: string;
  investmentDeployTxHash: string;
  scoreTierVerifierDeployTxHash: string;
}) {
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
  replaceOrAppend("FLOW_PAY_INVESTMENT_ADDRESS", addresses.investment);
  replaceOrAppend("SCORE_TIER_VERIFIER_ADDRESS", addresses.scoreTierVerifier);
  replaceOrAppend("FLOW_PAY_CORE_DEPLOY_TX_HASH", addresses.coreDeployTxHash);
  replaceOrAppend("FLOW_PAY_LOAN_DEPLOY_TX_HASH", addresses.loanDeployTxHash);
  replaceOrAppend("FLOW_PAY_CORE_SET_LOAN_TX_HASH", addresses.coreSetLoanTxHash);
  replaceOrAppend("FLOW_PAY_INVESTMENT_DEPLOY_TX_HASH", addresses.investmentDeployTxHash);
  replaceOrAppend("SCORE_TIER_VERIFIER_DEPLOY_TX_HASH", addresses.scoreTierVerifierDeployTxHash);

  fs.writeFileSync(envPath, content);
  console.log("Updated backend/.env with deployed contract addresses.");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const systemAdmin = deployer.address;
  const treasury = deployer.address;

  const Core = await ethers.getContractFactory("FlowPayCore");
  const core = await Core.deploy(systemAdmin);
  await core.waitForDeployment();
  const coreAddress = await core.getAddress();
  console.log(`FlowPayCore deployed to ${coreAddress}`);
  if (!core.deploymentTransaction()) {
    throw new Error("Missing deployment transaction for FlowPayCore");
  }
  const coreDeployTxHash = core.deploymentTransaction()!.hash;

  const Loan = await ethers.getContractFactory("FlowPayLoan");
  const loan = await Loan.deploy(coreAddress);
  await loan.waitForDeployment();
  const loanAddress = await loan.getAddress();
  console.log(`FlowPayLoan deployed to ${loanAddress}`);
  if (!loan.deploymentTransaction()) {
    throw new Error("Missing deployment transaction for FlowPayLoan");
  }
  const loanDeployTxHash = loan.deploymentTransaction()!.hash;

  const setLoanTx = await core.setLoanContract(loanAddress);
  await setLoanTx.wait();
  console.log(`FlowPayCore wired to FlowPayLoan at ${loanAddress}`);
  const coreSetLoanTxHash = setLoanTx.hash;

  const Investment = await ethers.getContractFactory("FlowPayInvestment");
  const investment = await Investment.deploy(systemAdmin, treasury);
  await investment.waitForDeployment();
  const investmentAddress = await investment.getAddress();
  console.log(`FlowPayInvestment deployed to ${investmentAddress}`);
  if (!investment.deploymentTransaction()) {
    throw new Error("Missing deployment transaction for FlowPayInvestment");
  }
  const investmentDeployTxHash = investment.deploymentTransaction()!.hash;

  const ScoreTierVerifier = await ethers.getContractFactory("ScoreTierVerifier");
  const scoreTierVerifier = await ScoreTierVerifier.deploy();
  await scoreTierVerifier.waitForDeployment();
  const scoreTierVerifierAddress = await scoreTierVerifier.getAddress();
  console.log(`ScoreTierVerifier deployed to ${scoreTierVerifierAddress}`);
  if (!scoreTierVerifier.deploymentTransaction()) {
    throw new Error("Missing deployment transaction for ScoreTierVerifier");
  }
  const scoreTierVerifierDeployTxHash = scoreTierVerifier.deploymentTransaction()!.hash;

  updateBackendEnv({
    core: coreAddress,
    loan: loanAddress,
    investment: investmentAddress,
    scoreTierVerifier: scoreTierVerifierAddress,
    coreDeployTxHash,
    loanDeployTxHash,
    coreSetLoanTxHash,
    investmentDeployTxHash,
    scoreTierVerifierDeployTxHash
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
