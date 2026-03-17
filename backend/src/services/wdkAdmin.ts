import WDK from "@tetherto/wdk";
import WalletManagerEvm, { WalletAccountEvm } from "@tetherto/wdk-wallet-evm";
import { ethers } from "ethers";
import { env } from "../config/env.js";
import { decryptMnemonicWithPasskey } from "../crypto/crypto.js";

const rpcUrl = env.RPC_URL.replace("{WDK_API_KEY}", env.WDK_API_KEY);
const transferMaxFee = BigInt(env.WDK_TRANSFER_MAX_FEE);
const provider = new ethers.JsonRpcProvider(rpcUrl);

export function getAdminProvider() {
  return provider;
}

export async function withAdminContext<T>(
  fn: (context: { wdk: WDK; account: WalletAccountEvm }) => Promise<T>
): Promise<T> {
  let seedPhrase = decryptMnemonicWithPasskey(env.ADMIN_SEED_PAYLOAD, env.MASTER_KEY);
  const wdk = new WDK(seedPhrase);
  wdk.registerWallet("ethereum", WalletManagerEvm, {
    provider: rpcUrl,
    transferMaxFee
  });
  const account = (await wdk.getAccount("ethereum", 0)) as unknown as WalletAccountEvm;
  try {
    return await fn({ wdk, account });
  } finally {
    seedPhrase = "";
    account.dispose();
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
  const txHash = await withAdminContext(async ({ account }) => {
    const result = await account.sendTransaction({
      to: contractAddress,
      data,
      value: valueWei
    });
    return result.hash;
  });

  const receipt = await provider.waitForTransaction(txHash);
  if (!receipt) {
    throw new Error("Transaction receipt is empty");
  }
  return receipt.hash;
}
