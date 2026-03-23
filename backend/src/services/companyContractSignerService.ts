import { Interface, keccak256, toUtf8Bytes } from "ethers";
import { db } from "../db/pool.js";
import { ApiError } from "../utils/errors.js";
import { sendContractTransaction } from "./walletService.js";

export type CompanyContractSigner = {
  companyId: string;
  companyKey: string;
  walletId: string;
  walletAddress: string;
  treasuryWalletId: string;
  treasuryWalletAddress: string;
};

export function getCompanyContractKey(companyId: string) {
  return keccak256(toUtf8Bytes(companyId));
}

export async function getCompanyContractSigner(companyId: string): Promise<CompanyContractSigner> {
  const result = await db.query(
    `SELECT
       c.id AS company_id,
       signer.id AS signer_wallet_id,
       signer.wallet_address AS signer_wallet_address,
       treasury.id AS treasury_wallet_id,
       treasury.wallet_address AS treasury_wallet_address
     FROM companies c
     JOIN wallets treasury ON treasury.id = c.treasury_wallet_id
     JOIN wallets signer ON signer.id = COALESCE(c.contract_signer_wallet_id, c.treasury_wallet_id)
     WHERE c.id = $1`,
    [companyId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company contract signer wallet not found");
  }

  const row = result.rows[0];
  return {
    companyId: row.company_id as string,
    companyKey: getCompanyContractKey(companyId),
    walletId: row.signer_wallet_id as string,
    walletAddress: row.signer_wallet_address as string,
    treasuryWalletId: row.treasury_wallet_id as string,
    treasuryWalletAddress: row.treasury_wallet_address as string
  };
}

export async function sendCompanyManagedContractTransaction(params: {
  companyId: string;
  contractAddress: string;
  abi: string[];
  method: string;
  args: unknown[];
  valueWei?: bigint;
}) {
  const signer = await getCompanyContractSigner(params.companyId);
  const iface = new Interface(params.abi);
  const data = iface.encodeFunctionData(params.method, params.args);

  const tx = await sendContractTransaction({
    fromWalletId: signer.walletId,
    toAddress: params.contractAddress,
    data,
    valueWei: params.valueWei ?? 0n,
    recordTransaction: false
  });

  return {
    txHash: tx.txHash,
    from: tx.from,
    to: tx.to,
    signer
  };
}
