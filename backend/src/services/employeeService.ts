import { pool } from "../db/pool.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { createEmployeeWallet } from "./walletService.js";
import { sendEmployeeInvite } from "./emailService.js";
import { ApiError } from "../utils/errors.js";
import { env } from "../config/env.js";

export async function addEmployee(input: {
  companyId: string;
  fullName: string;
  email: string;
  salary: number;
  creditScore?: number;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const activationToken = uuidv4();
    const insertResult = await client.query(
      `INSERT INTO employees (company_id, full_name, email, salary, credit_score, status, activation_token)
       VALUES ($1, $2, $3, $4, $5, 'invited', $6)
       RETURNING id, company_id, full_name, email, salary, credit_score, status`,
      [
        input.companyId,
        input.fullName,
        input.email,
        input.salary,
        input.creditScore ?? 600,
        activationToken
      ]
    );
    const employee = insertResult.rows[0];
    const wallet = await createEmployeeWallet(employee.id, client);
    await client.query("COMMIT");

    await sendEmployeeInvite(employee.email, activationToken);

    return {
      employee,
      wallet,
      activationToken,
      activationUrl: `${env.APP_BASE_URL}/employees/activate?token=${activationToken}`
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function activateEmployee(token: string, password: string) {
  const employeeResult = await pool.query(
    "SELECT id, status FROM employees WHERE activation_token = $1",
    [token]
  );
  if (employeeResult.rowCount === 0) {
    throw new ApiError(404, "Invalid activation token");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const employee = employeeResult.rows[0];

  await pool.query(
    `UPDATE employees
     SET password_hash = $1, activated_at = now(), status = 'active', activation_token = NULL
     WHERE id = $2`,
    [passwordHash, employee.id]
  );

  return { employeeId: employee.id, status: "active" };
}
