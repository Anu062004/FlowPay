import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

function updateBackendEnv(addresses: {
  core: string;
  loan: string;
  investment: string;
  scoreTierVerifier: string;
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

  fs.writeFileSync(envPath, content);
  console.log("Updated backend/.env with deployed contract addresses.");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = deployer.address;
  const treasury = deployer.address;

  const Core = await ethers.getContractFactory("FlowPayCore");
  const core = await Core.deploy(admin);
  await core.waitForDeployment();
  const coreAddress = await core.getAddress();
  console.log(`FlowPayCore deployed to ${coreAddress}`);

  const Loan = await ethers.getContractFactory("FlowPayLoan");
  const loan = await Loan.deploy(admin, coreAddress);
  await loan.waitForDeployment();
  const loanAddress = await loan.getAddress();
  console.log(`FlowPayLoan deployed to ${loanAddress}`);

  const setLoanTx = await core.setLoanContract(loanAddress);
  await setLoanTx.wait();
  console.log(`FlowPayCore wired to FlowPayLoan at ${loanAddress}`);

  const Investment = await ethers.getContractFactory("FlowPayInvestment");
  const investment = await Investment.deploy(admin, treasury);
  await investment.waitForDeployment();
  const investmentAddress = await investment.getAddress();
  console.log(`FlowPayInvestment deployed to ${investmentAddress}`);

  const ScoreTierVerifier = await ethers.getContractFactory("ScoreTierVerifier");
  const scoreTierVerifier = await ScoreTierVerifier.deploy(admin);
  await scoreTierVerifier.waitForDeployment();
  const scoreTierVerifierAddress = await scoreTierVerifier.getAddress();
  console.log(`ScoreTierVerifier deployed to ${scoreTierVerifierAddress}`);

  updateBackendEnv({
    core: coreAddress,
    loan: loanAddress,
    investment: investmentAddress,
    scoreTierVerifier: scoreTierVerifierAddress
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
