import { ethers } from "hardhat";

async function deployAndReport(factoryName: string, args: unknown[] = []) {
  const factory = await ethers.getContractFactory(factoryName);
  const contract = await factory.deploy(...args);
  const tx = contract.deploymentTransaction();
  if (!tx) {
    throw new Error(`Missing deployment transaction for ${factoryName}`);
  }
  const receipt = await tx.wait();
  const gasUsed = receipt?.gasUsed ?? 0n;
  console.log(`${factoryName} gasUsed: ${gasUsed.toString()}`);
  return { contract, gasUsed };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = deployer.address;
  const treasury = deployer.address;

  const { contract: core, gasUsed: coreGas } = await deployAndReport("FlowPayCore", [admin]);
  const coreAddress = await core.getAddress();
  const { gasUsed: loanGas } = await deployAndReport("FlowPayLoan", [admin, coreAddress]);
  const { gasUsed: investmentGas } = await deployAndReport("FlowPayInvestment", [admin, treasury]);

  const total = coreGas + loanGas + investmentGas;
  console.log(`Total gas (3 contracts): ${total.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
