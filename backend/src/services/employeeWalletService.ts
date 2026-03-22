import { ethers } from "ethers";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";
import { formatAmount, parseAmount } from "../utils/amounts.js";
import { getWalletBalance, minimumGasReserveWei, nativeTransferMaxFee, sendTransaction } from "./walletService.js";

async function getEmployeeWalletRow(employeeId: string) {
  const result = await db.query(
    `SELECT
       e.id,
       e.status,
       e.wallet_id,
       w.wallet_address,
       w.chain
     FROM employees e
     JOIN wallets w ON w.id = e.wallet_id
     WHERE e.id = $1`,
    [employeeId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Employee wallet not found");
  }

  return result.rows[0] as {
    id: string;
    status: string;
    wallet_id: string;
    wallet_address: string;
    chain: string;
  };
}

export async function getEmployeeWalletDetails(employeeId: string) {
  const wallet = await getEmployeeWalletRow(employeeId);
  const balance = await getWalletBalance(wallet.wallet_id);

  const balanceWei = BigInt(balance.balanceWei);
  const maxWithdrawableWei =
    balance.tokenSymbol === "ETH" && balanceWei > nativeTransferMaxFee
      ? balanceWei - nativeTransferMaxFee
      : 0n;

  return {
    wallet_address: balance.walletAddress,
    balance: balance.balanceEth,
    token_symbol: balance.tokenSymbol,
    chain: wallet.chain,
    max_withdrawable: balance.tokenSymbol === "ETH" ? formatAmount(maxWithdrawableWei) : balance.balanceEth,
    native_gas_balance: balance.nativeGasBalanceEth,
    native_gas_reserve: formatAmount(minimumGasReserveWei),
    gas_reserve_satisfied: balance.gasReserveSatisfied
  };
}

export async function withdrawEmployeeFunds(
  employeeId: string,
  destinationAddress: string,
  amountEth: number
) {
  const wallet = await getEmployeeWalletRow(employeeId);

  if (wallet.status !== "active") {
    throw new ApiError(400, "Only active employees can withdraw funds");
  }
  if (!ethers.isAddress(destinationAddress)) {
    throw new ApiError(400, "Destination wallet address is invalid");
  }
  if (destinationAddress.toLowerCase() === wallet.wallet_address.toLowerCase()) {
    throw new ApiError(400, "Destination address must be different from your employee wallet");
  }

  const amountWei = parseAmount(amountEth);
  if (amountWei <= 0n) {
    throw new ApiError(400, "Withdrawal amount must be greater than zero");
  }

  const transfer = await sendTransaction(
    wallet.wallet_id,
    destinationAddress,
    amountEth,
    "withdrawal"
  );

  return {
    txHash: transfer.txHash ?? null,
    amount: amountEth.toString(),
    from: transfer.from,
    to: transfer.to,
    token_symbol: balanceTokenSymbol()
  };
}

function balanceTokenSymbol() {
  return env.TREASURY_TOKEN_SYMBOL ?? "ETH";
}
