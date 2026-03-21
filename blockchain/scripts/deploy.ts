import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("FlowPayCore");
  const core = await factory.deploy(deployer.address);
  await core.waitForDeployment();
  console.log(`FlowPayCore deployed to ${await core.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
