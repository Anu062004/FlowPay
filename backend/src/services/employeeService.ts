import { pool } from "../db/pool.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { createEmployeeWallet } from "./walletService.js";
import { sendEmployeeInvite } from "./emailService.js";
import { ApiError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { getEmployeeProfile } from "./authService.js";

function getActivationUrl(token: string) {
  return `${env.APP_BASE_URL}/employees/activate?token=${token}`;
}

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

    await sendEmployeeInvite({
      email: employee.email,
      activationToken,
      companyId: input.companyId,
      employeeId: employee.id,
      activationUrl: getActivationUrl(activationToken)
    });

    return {
      employee,
      wallet,
      activationToken,
      activationUrl: getActivationUrl(activationToken)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function registerEmployeeWallet(input: {
  fullName: string;
  password: string;
  email?: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const passwordHash = await bcrypt.hash(input.password, 12);
    const insertResult = await client.query(
      `INSERT INTO employees (full_name, email, salary, status, activated_at, password_hash)
       VALUES ($1, $2, 0, 'active', now(), $3)
       RETURNING id, company_id, full_name, COALESCE(email, '') AS email, salary, credit_score, status, created_at`,
      [input.fullName, input.email?.trim() || null, passwordHash]
    );
    const employee = insertResult.rows[0];
    const wallet = await createEmployeeWallet(employee.id, client);
    await client.query("COMMIT");

    return {
      employee,
      wallet
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

  const profile = await getEmployeeProfile(employee.id);
  return { employeeId: employee.id, status: "active", employee: profile };
}

export async function resendEmployeeInvite(employeeId: string, companyId?: string) {
  const result = await pool.query(
    `SELECT id, company_id, email, status, activation_token
     FROM employees
     WHERE id = $1`,
    [employeeId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Employee not found");
  }

  const employee = result.rows[0] as {
    id: string;
    company_id: string;
    email: string | null;
    status: string;
    activation_token: string | null;
  };

  if (companyId && employee.company_id !== companyId) {
    throw new ApiError(403, "This employee does not belong to the current company");
  }

  if (employee.status === "active") {
    throw new ApiError(400, "Employee is already active");
  }

  if (!employee.email) {
    throw new ApiError(400, "Employee invite email is missing");
  }

  let activationToken = employee.activation_token;
  if (!activationToken) {
    activationToken = uuidv4();
    await pool.query(
      `UPDATE employees
       SET activation_token = $1, status = 'invited'
       WHERE id = $2`,
      [activationToken, employee.id]
    );
  }

  const activationUrl = getActivationUrl(activationToken);
  await sendEmployeeInvite({
    email: employee.email,
    activationToken,
    companyId: employee.company_id,
    employeeId: employee.id,
    activationUrl
  });

  return {
    employeeId: employee.id,
    email: employee.email,
    status: "invited",
    activationUrl
  };
}
