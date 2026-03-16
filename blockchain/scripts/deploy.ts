import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("FlowPayVault");
  const vault = await factory.deploy(deployer.address);
  await vault.waitForDeployment();
  console.log(`FlowPayVault deployed to ${await vault.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
