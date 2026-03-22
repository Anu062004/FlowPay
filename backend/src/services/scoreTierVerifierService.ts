import { ethers } from "ethers";
import { env } from "../config/env.js";
import { getAdminSigner, getAdminProvider } from "./wdkAdmin.js";
import { computeEmployeeCommit } from "../zk/poseidon.js";
import type { ScoreTierSolidityCalldata } from "../zk/generateTierProof.js";

const SCORE_TIER_VERIFIER_ABI = [
  "function registerEmployeeCommit(address employeeAddr, uint256 employeeCommit) external",
  "function verifyScoreTier(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals, address employeeAddr) external returns (bool)",
  "function previewVerifyScoreTier(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals, address employeeAddr) external view returns (bool)"
];

function getVerifierAddress() {
  const address = env.SCORE_TIER_VERIFIER_ADDRESS?.trim();
  if (!address) {
    throw new Error("SCORE_TIER_VERIFIER_ADDRESS is not configured");
  }
  return address;
}

function getVerifierContract() {
  const signer = getAdminSigner();
  return new ethers.Contract(getVerifierAddress(), SCORE_TIER_VERIFIER_ABI, signer);
}

export async function registerEmployeeCommitOnVerifier(employeeAddr: string, companySalt: string) {
  const contract = getVerifierContract();
  const employeeCommit = await computeEmployeeCommit(employeeAddr, companySalt);
  const tx = await contract.registerEmployeeCommit(employeeAddr, employeeCommit);
  await tx.wait();
  return {
    txHash: tx.hash as string,
    employeeCommit: employeeCommit.toString()
  };
}

export async function verifyScoreTierOnChain(input: {
  employeeAddr: string;
  solidityCalldata: ScoreTierSolidityCalldata;
}) {
  const contract = getVerifierContract();
  const verified = await contract.previewVerifyScoreTier(
    input.solidityCalldata.pA,
    input.solidityCalldata.pB,
    input.solidityCalldata.pC,
    input.solidityCalldata.pubSignals,
    input.employeeAddr
  );

  if (!verified) {
    throw new Error("Score tier proof preview verification failed");
  }

  const tx = await contract.verifyScoreTier(
    input.solidityCalldata.pA,
    input.solidityCalldata.pB,
    input.solidityCalldata.pC,
    input.solidityCalldata.pubSignals,
    input.employeeAddr
  );
  await tx.wait();

  return {
    verified: true,
    txHash: tx.hash as string,
    employeeAddr: ethers.getAddress(input.employeeAddr)
  };
}
