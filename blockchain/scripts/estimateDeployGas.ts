import { ethers } from "hardhat";

async function deployAndReport(name: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  if (!tx) {
    throw new Error(`Missing deployment transaction for ${name}`);
  }
  const receipt = await tx.wait();
  const gasUsed = receipt?.gasUsed ?? 0n;
  console.log(`${name} gasUsed: ${gasUsed.toString()}`);
  return gasUsed;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = deployer.address;
  const treasury = deployer.address;

  const vaultGas = await deployAndReport("FlowPayVault", [admin]);
  const loanGas = await deployAndReport("FlowPayLoan", [admin]);
  const investmentGas = await deployAndReport("FlowPayInvestment", [admin, treasury]);

  const total = vaultGas + loanGas + investmentGas;
  console.log(`Total gas (3 contracts): ${total.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
