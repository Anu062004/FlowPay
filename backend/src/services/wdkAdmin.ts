import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { ethers } from "ethers";
import { env } from "../config/env.js";
import { decryptMnemonicWithPasskey } from "../crypto/crypto.js";
import {
  getContractRoundRobinRpcUrl,
  getContractRpcProvider,
  withContractRpcFailover
} from "./rpcService.js";
import { withRpcRetry } from "./rpcRetryService.js";

const transferMaxFee = BigInt(env.WDK_TRANSFER_MAX_FEE);
const adminPrivateKey = env.ADMIN_PRIVATE_KEY?.trim() || null;

export function getAdminProvider() {
  return getContractRpcProvider();
}

export function hasAdminPrivateKey() {
  return Boolean(adminPrivateKey);
}

export function getAdminSigner() {
  if (!adminPrivateKey) {
    throw new Error("ADMIN_PRIVATE_KEY is not configured");
  }
  return new ethers.Wallet(adminPrivateKey, getContractRpcProvider(getContractRoundRobinRpcUrl()));
}

export async function withAdminContext<T>(
  fn: (context: { wdk: WDK; account: WalletAccountEvm }) => Promise<T>
): Promise<T> {
  if (adminPrivateKey) {
    throw new Error("WDK admin context is unavailable when ADMIN_PRIVATE_KEY is configured. Use the signer-based admin helpers instead.");
  }

  const rpcUrl = getContractRoundRobinRpcUrl();
  const seedPayload = env.ADMIN_SEED_PAYLOAD?.trim();
  if (!seedPayload) {
    throw new Error("ADMIN_SEED_PAYLOAD is not configured. Set ADMIN_PRIVATE_KEY or provide a valid ADMIN_SEED_PAYLOAD.");
  }

  let seedPhrase = "";
  let account: WalletAccountEvm | null = null;
  try {
    seedPhrase = decryptMnemonicWithPasskey(seedPayload, env.MASTER_KEY);
    const wdk = new WDK(seedPhrase);
    wdk.registerWallet("ethereum", WalletManagerEvm, {
      provider: rpcUrl,
      transferMaxFee
    });
    account = (await wdk.getAccount("ethereum", 0)) as unknown as WalletAccountEvm;
    return await fn({ wdk, account });
  } catch (error) {
    if (error instanceof Error && /invalid seed/i.test(error.message)) {
      throw new Error("Invalid admin WDK seed. Set ADMIN_PRIVATE_KEY or provide a valid ADMIN_SEED_PAYLOAD.");
    }
    throw error;
  } finally {
    seedPhrase = "";
    account?.dispose();
  }
}

export async function sendAdminTransaction(
  contractAddress: string,
  abi: string[],
  method: string,
  args: unknown[],
  valueWei: bigint = 0n
): Promise<string> {
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData(method, args);

  if (adminPrivateKey) {
    const txHash = await withContractRpcFailover("admin signer sendTransaction", async (provider) => {
      const signer = new ethers.Wallet(adminPrivateKey, provider);
      const tx = await withRpcRetry("admin signer sendTransaction", () =>
        signer.sendTransaction({
          to: contractAddress,
          data,
          value: valueWei
        })
      );
      return tx.hash;
    });
    const receipt = await withContractRpcFailover(`admin signer waitForTransaction ${txHash}`, (provider) =>
      provider.waitForTransaction(txHash)
    );
    if (!receipt) {
      throw new Error("Transaction receipt is empty");
    }
    return txHash;
  }

  const txHash = await withAdminContext(async ({ account }) => {
    const result = await account.sendTransaction({
      to: contractAddress,
      data,
      value: valueWei
    });
    return result.hash;
  });

  const receipt = await withContractRpcFailover(`provider waitForTransaction ${txHash}`, (provider) =>
    provider.waitForTransaction(txHash)
  );
  if (!receipt) {
    throw new Error("Transaction receipt is empty");
  }
  return receipt.hash;
}
