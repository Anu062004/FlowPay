import { pool } from "../db/pool.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { createEmployeeWallet } from "./walletService.js";
import { sendEmployeeAccessEmail, sendEmployeeInvite } from "./emailService.js";
import { ApiError } from "../utils/errors.js";
import { env } from "../config/env.js";
import { getEmployeeProfile } from "./authService.js";
import { ensureEmployeeInitializedOnCore } from "./contractService.js";

function getActivationUrl(token: string) {
  return `${env.APP_BASE_URL}/employees/activate?token=${token}`;
}

function isPgError(error: unknown): error is { code?: string; constraint?: string; detail?: string } {
  return typeof error === "object" && error !== null;
}

function mapEmployeeInsertError(error: unknown) {
  if (isPgError(error) && error.code === "23505") {
    const constraint = error.constraint ?? "";
    const detail = error.detail ?? "";
    if (constraint === "employees_email_key" || /email/i.test(constraint) || /Key \(email\)=/i.test(detail)) {
      return new ApiError(409, "An employee with this email already exists");
    }
  }
  return error;
}

export async function addEmployee(input: {
  companyId: string;
  fullName: string;
  email: string;
  salary: number;
  creditScore?: number;
}) {
  const client = await pool.connect();
  const activationToken = uuidv4();
  const activationUrl = getActivationUrl(activationToken);
  let employee: {
    id: string;
    company_id: string;
    full_name: string;
    email: string;
    salary: string;
    credit_score: number;
    status: string;
  };
  let wallet: {
    id: string;
    wallet_id: string;
    wallet_address: string;
  };
  try {
    await client.query("BEGIN");
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
    employee = insertResult.rows[0];
    wallet = await createEmployeeWallet(employee.id, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw mapEmployeeInsertError(error);
  } finally {
    client.release();
  }

  const warnings: Array<{ code: string; message: string }> = [];

  try {
    const coreState = await ensureEmployeeInitializedOnCore(input.companyId, wallet.wallet_address, input.salary, 1);
    await pool.query("UPDATE employees SET credit_score = $1 WHERE id = $2", [coreState.score, employee.id]);
    employee.credit_score = coreState.score;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({
      code: "core_init_failed",
      message: `Blockchain initialization is pending: ${message}`
    });
    console.error(`[EmployeeAdd] Core initialization failed for employee ${employee.id}`, error);
  }

  try {
    const delivered = await sendEmployeeInvite({
      email: employee.email,
      activationToken,
      companyId: input.companyId,
      employeeId: employee.id,
      activationUrl
    });

    if (!delivered) {
      warnings.push({
        code: "invite_delivery_skipped",
        message: "Invite delivery was skipped by the current email provider settings. Use the activation URL manually."
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push({
      code: "invite_delivery_failed",
      message: `Invite delivery failed: ${message}`
    });
    console.error(`[EmployeeAdd] Invite delivery failed for employee ${employee.id}`, error);
  }

  return {
    employee,
    wallet,
    activationToken,
    activationUrl,
    warnings
  };
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

    if (employee.email) {
      await sendEmployeeAccessEmail({
        companyId: employee.company_id ?? undefined,
        employeeId: employee.id,
        fullName: employee.full_name,
        email: employee.email,
        walletAddress: wallet.wallet_address
      });
    }

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
