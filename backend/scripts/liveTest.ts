import { db, pool } from "../src/db/pool.js";
import { addEmployee, activateEmployee } from "../src/services/employeeService.js";
import { runPayroll } from "../src/services/payrollService.js";
import { getWalletBalance } from "../src/services/walletService.js";

const companyId = process.argv[2];
const testEmail = process.argv[3];

if (!companyId || !testEmail) {
  console.error("Usage: tsx scripts/liveTest.ts <companyId> <testEmail>");
  process.exit(1);
}

async function main() {
  const companyResult = await db.query(
    `SELECT c.id, c.name, c.treasury_wallet_id, w.wallet_address
     FROM companies c
     LEFT JOIN wallets w ON c.treasury_wallet_id = w.id
     WHERE c.id = $1`,
    [companyId]
  );
  if ((companyResult.rowCount ?? 0) === 0) {
    throw new Error(`Company not found: ${companyId}`);
  }
  const company = companyResult.rows[0];

  console.log("Company:", {
    id: company.id,
    name: company.name,
    treasuryWalletId: company.treasury_wallet_id,
    treasuryAddress: company.wallet_address
  });

  let employeeId: string | null = null;
  let activationToken: string | null = null;

  try {
    const created = await addEmployee({
      companyId,
      fullName: "Test Employee",
      email: testEmail,
      salary: 0.01,
      creditScore: 700
    });
    employeeId = created.employee.id;
    activationToken = created.activationToken;
    console.log("Employee invited:", { employeeId, activationToken });
  } catch (error: any) {
    console.warn("Add employee failed, attempting to recover from DB:", error?.message ?? error);
    const existing = await db.query(
      "SELECT id, activation_token, status FROM employees WHERE email = $1 AND company_id = $2 ORDER BY created_at DESC LIMIT 1",
      [testEmail, companyId]
    );
    if ((existing.rowCount ?? 0) === 0) {
      throw error;
    }
    employeeId = existing.rows[0].id;
    activationToken = existing.rows[0].activation_token;
    console.log("Employee recovered:", {
      employeeId,
      status: existing.rows[0].status,
      activationToken
    });
  }

  if (!activationToken) {
    throw new Error("No activation token available for employee");
  }

  const activation = await activateEmployee(activationToken, "TestPass123!");
  console.log("Employee activated:", activation);

  if (!company.treasury_wallet_id) {
    throw new Error("Company does not have a treasury wallet");
  }

  const balance = await getWalletBalance(company.treasury_wallet_id);
  console.log("Treasury balance:", balance);

  try {
    const payroll = await runPayroll(companyId);
    console.log("Payroll result:", payroll);
  } catch (error: any) {
    console.error("Payroll failed:", error?.message ?? error);
  }

  const txs = await db.query(
    `SELECT t.id, t.type, t.amount, t.token_symbol, t.tx_hash, t.created_at
     FROM transactions t
     JOIN wallets w ON t.wallet_id = w.id
     JOIN companies c ON c.treasury_wallet_id = w.id
     WHERE c.id = $1
     ORDER BY t.created_at DESC
     LIMIT 10`,
    [companyId]
  );
  console.log("Recent transactions:", txs.rows);
}

main()
  .catch((error) => {
    console.error("Live test failed:", error?.message ?? error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
