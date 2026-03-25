import { ethers } from "ethers";
import { computeEmployeeCommit } from "../zk/poseidon.js";
import type { ScoreTierSolidityCalldata } from "../zk/generateTierProof.js";
import { getCompanyContractKey, sendCompanyManagedContractTransaction } from "./companyContractSignerService.js";
import { getContractRpcProviderForChain } from "./rpcService.js";
import { getCompanySettlementChain } from "./companySettlementService.js";
import { getContractAddressesForChain } from "../utils/settlement.js";

const SCORE_TIER_VERIFIER_ABI = [
  "function registerCompanyActor(bytes32 companyId, address actor) external",
  "function updateCompanyActor(bytes32 companyId, address newActor) external",
  "function registerEmployeeCommit(bytes32 companyId, address employeeAddr, uint256 employeeCommit) external",
  "function verifyScoreTier(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals, address employeeAddr) external returns (bool)",
  "function previewVerifyScoreTier(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals, address employeeAddr) external view returns (bool)"
];

async function getVerifierAddress(companyId: string) {
  const chain = await getCompanySettlementChain(companyId);
  return getContractAddressesForChain(chain).verifier;
}

async function getVerifierContract(companyId: string) {
  const chain = await getCompanySettlementChain(companyId);
  return new ethers.Contract(
    getContractAddressesForChain(chain).verifier,
    SCORE_TIER_VERIFIER_ABI,
    getContractRpcProviderForChain(chain)
  );
}

export async function registerEmployeeCommitOnVerifier(
  companyId: string,
  employeeAddr: string,
  companySalt: string
) {
  const employeeCommit = await computeEmployeeCommit(employeeAddr, companySalt);
  const verifierAddress = await getVerifierAddress(companyId);
  const tx = await sendCompanyManagedContractTransaction({
    companyId,
    contractAddress: verifierAddress,
    abi: SCORE_TIER_VERIFIER_ABI,
    method: "registerEmployeeCommit",
    args: [getCompanyContractKey(companyId), employeeAddr, employeeCommit]
  });

  return {
    txHash: tx.txHash as string,
    employeeCommit: employeeCommit.toString()
  };
}

export async function verifyScoreTierOnChain(input: {
  companyId: string;
  employeeAddr: string;
  solidityCalldata: ScoreTierSolidityCalldata;
}) {
  const verifierAddress = await getVerifierAddress(input.companyId);
  const contract = await getVerifierContract(input.companyId);
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

  const tx = await sendCompanyManagedContractTransaction({
    companyId: input.companyId,
    contractAddress: verifierAddress,
    abi: SCORE_TIER_VERIFIER_ABI,
    method: "verifyScoreTier",
    args: [
      input.solidityCalldata.pA,
      input.solidityCalldata.pB,
      input.solidityCalldata.pC,
      input.solidityCalldata.pubSignals,
      input.employeeAddr
    ]
  });

  return {
    verified: true,
    txHash: tx.txHash as string,
    employeeAddr: ethers.getAddress(input.employeeAddr)
  };
}
