import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

function updateBackendEnv(addresses: {
  vault: string;
  loan: string;
  investment: string;
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

  replaceOrAppend("VAULT_CONTRACT_ADDRESS", addresses.vault);
  replaceOrAppend("LOAN_CONTRACT_ADDRESS", addresses.loan);
  replaceOrAppend("INVESTMENT_CONTRACT_ADDRESS", addresses.investment);

  fs.writeFileSync(envPath, content);
  console.log("Updated backend/.env with deployed contract addresses.");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = deployer.address;
  const treasury = deployer.address;

  const Vault = await ethers.getContractFactory("FlowPayVault");
  const vault = await Vault.deploy(admin);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`FlowPayVault deployed to ${vaultAddress}`);

  const Loan = await ethers.getContractFactory("FlowPayLoan");
  const loan = await Loan.deploy(admin);
  await loan.waitForDeployment();
  const loanAddress = await loan.getAddress();
  console.log(`FlowPayLoan deployed to ${loanAddress}`);

  const Investment = await ethers.getContractFactory("FlowPayInvestment");
  const investment = await Investment.deploy(admin, treasury);
  await investment.waitForDeployment();
  const investmentAddress = await investment.getAddress();
  console.log(`FlowPayInvestment deployed to ${investmentAddress}`);

  updateBackendEnv({
    vault: vaultAddress,
    loan: loanAddress,
    investment: investmentAddress
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
