import { ethers } from "ethers";
import { buildPoseidon } from "circomlibjs";

const SNARK_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

let poseidonFactoryPromise: Promise<Awaited<ReturnType<typeof buildPoseidon>>> | null = null;

async function getPoseidonFactory() {
  if (!poseidonFactoryPromise) {
    poseidonFactoryPromise = buildPoseidon();
  }
  return poseidonFactoryPromise;
}

export function employeeAddressToField(employeeAddr: string) {
  return BigInt(ethers.getAddress(employeeAddr));
}

export function textToField(value: string) {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes(value))) % SNARK_FIELD;
}

export function deriveCompanySalt(companyId: string, seed: string) {
  return `${companyId}:${seed}`;
}

export async function computeEmployeeCommit(employeeAddr: string, salt: string) {
  const poseidon = await getPoseidonFactory();
  const employeeField = employeeAddressToField(employeeAddr);
  const saltField = textToField(salt);
  const result = poseidon([employeeField, saltField]);
  return BigInt(poseidon.F.toString(result));
}
