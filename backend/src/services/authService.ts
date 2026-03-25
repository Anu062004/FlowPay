import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { db } from "../db/pool.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/errors.js";
import { sendCompanyRecoveryEmail, sendEmployeeRecoveryEmail } from "./emailService.js";
import { syncEmployeeCreditScoreOnCore } from "./contractService.js";

const COMPANY_SESSION_COOKIE = "flowpay_company_session";
const EMPLOYEE_SESSION_COOKIE = "flowpay_employee_session";
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const RECOVERY_TOKEN_TTL_MS = 60 * 60 * 1000;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export type CompanyProfile = {
  id: string;
  name: string;
  email: string;
  treasury_address: string | null;
  treasury_chain?: string | null;
  created_at: string;
};

export type EmployeeProfile = {
  id: string;
  full_name: string;
  email: string;
  salary: string;
  credit_score: number;
  status: string;
  created_at: string;
  wallet_address: string | null;
  company_id?: string | null;
  company_name?: string | null;
};

export type CompanySession = {
  role: "company";
  companyId: string;
  exp: number;
};

export type EmployeeSession = {
  role: "employee";
  employeeId: string;
  companyId: string | null;
  exp: number;
};

type ResolvedCompany = CompanyProfile & {
  access_pin_hash: string | null;
};

type ResolvedEmployee = EmployeeProfile & {
  password_hash: string | null;
};

function sanitizeCompany(company: ResolvedCompany): CompanyProfile {
  const { access_pin_hash: _accessPinHash, ...publicCompany } = company;
  return publicCompany;
}

function sanitizeEmployee(employee: ResolvedEmployee): EmployeeProfile {
  const { password_hash: _passwordHash, ...publicEmployee } = employee;
  return publicEmployee;
}

async function hydrateEmployeeCreditScore<T extends {
  id: string;
  wallet_address: string | null;
  credit_score: number;
  salary: string | number;
  company_id?: string | null;
}>(
  employee: T
): Promise<T> {
  if (!employee.wallet_address) {
    return employee;
  }

  try {
    const creditScore = await syncEmployeeCreditScoreOnCore(employee.wallet_address, employee.salary, {
      companyId: employee.company_id ?? undefined
    });
    if (creditScore !== employee.credit_score) {
      await db.query("UPDATE employees SET credit_score = $1 WHERE id = $2", [creditScore, employee.id]);
    }
    return {
      ...employee,
      credit_score: creditScore
    } as T;
  } catch {
    return employee;
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: env.NODE_ENV === "production" ? ("none" as const) : ("lax" as const),
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge
  };
}

function parseCookies(header?: string) {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) {
      continue;
    }
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }

  return cookies;
}

function signToken(payload: CompanySession | EmployeeSession) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", env.MASTER_KEY).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyToken<T extends CompanySession | EmployeeSession>(token: string, role: T["role"]): T | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = crypto.createHmac("sha256", env.MASTER_KEY).update(encodedPayload).digest("base64url");
  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (received.length !== computed.length || !crypto.timingSafeEqual(received, computed)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as T;
    if (parsed.role !== role || parsed.exp <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseTimeoutLabel(label?: string | null) {
  switch (label) {
    case "1 hour":
      return 60 * 60 * 1000;
    case "4 hours":
      return 4 * 60 * 60 * 1000;
    case "8 hours":
      return 8 * 60 * 60 * 1000;
    case "30 minutes":
    default:
      return DEFAULT_SESSION_TIMEOUT_MS;
  }
}

function buildRecoveryTokenRecord() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

function hashRecoveryToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getCompanyRecoveryUrl(token: string) {
  return `${env.APP_BASE_URL}/recover/company?token=${encodeURIComponent(token)}`;
}

function getEmployeeRecoveryUrl(token: string) {
  return `${env.APP_BASE_URL}/recover/employee?token=${encodeURIComponent(token)}`;
}

async function getCompanySessionTimeout(companyId?: string | null) {
  if (!companyId) {
    return DEFAULT_SESSION_TIMEOUT_MS;
  }

  const result = await db.query(
    `SELECT security->>'sessionTimeout' AS session_timeout
     FROM company_settings
     WHERE company_id = $1`,
    [companyId]
  );

  return parseTimeoutLabel(result.rows[0]?.session_timeout ?? null);
}

async function findCompanyByAccess(access: string) {
  const normalized = access.trim();
  if (!normalized) {
    throw new ApiError(400, "Company ID, registered email, or treasury wallet address is required");
  }

  const result = uuidRegex.test(normalized)
    ? await db.query(
        `SELECT c.id, c.name, c.email, c.created_at, c.access_pin_hash, w.wallet_address AS treasury_address, w.chain AS treasury_chain
         FROM companies c
         LEFT JOIN wallets w ON c.treasury_wallet_id = w.id
         WHERE c.id = $1`,
        [normalized]
      )
    : emailRegex.test(normalized)
      ? await db.query(
          `SELECT c.id, c.name, c.email, c.created_at, c.access_pin_hash, w.wallet_address AS treasury_address, w.chain AS treasury_chain
           FROM companies c
           LEFT JOIN wallets w ON c.treasury_wallet_id = w.id
           WHERE LOWER(c.email) = LOWER($1)`,
          [normalized]
        )
      : await db.query(
          `SELECT c.id, c.name, c.email, c.created_at, c.access_pin_hash, w.wallet_address AS treasury_address, w.chain AS treasury_chain
           FROM companies c
           JOIN wallets w ON c.treasury_wallet_id = w.id
           WHERE LOWER(w.wallet_address) = LOWER($1)`,
          [normalized]
        );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company access not found");
  }

  return result.rows[0] as ResolvedCompany;
}

async function findEmployeeByAccess(access: string) {
  const normalized = access.trim();
  if (!normalized) {
    throw new ApiError(400, "Employee ID, registered email, or wallet address is required");
  }

  const result = uuidRegex.test(normalized)
    ? await db.query(
        `SELECT
           e.id,
           e.full_name,
           COALESCE(e.email, '') AS email,
           e.salary,
           e.credit_score,
           e.status,
           e.created_at,
           e.password_hash,
           e.company_id,
           c.name AS company_name,
           w.wallet_address
         FROM employees e
         LEFT JOIN wallets w ON e.wallet_id = w.id
         LEFT JOIN companies c ON e.company_id = c.id
         WHERE e.id = $1`,
        [normalized]
      )
    : emailRegex.test(normalized)
      ? await db.query(
          `SELECT
             e.id,
             e.full_name,
             COALESCE(e.email, '') AS email,
             e.salary,
             e.credit_score,
             e.status,
             e.created_at,
             e.password_hash,
             e.company_id,
             c.name AS company_name,
             w.wallet_address
           FROM employees e
           LEFT JOIN wallets w ON e.wallet_id = w.id
           LEFT JOIN companies c ON e.company_id = c.id
           WHERE LOWER(COALESCE(e.email, '')) = LOWER($1)`,
          [normalized]
        )
      : await db.query(
          `SELECT
             e.id,
             e.full_name,
             COALESCE(e.email, '') AS email,
             e.salary,
             e.credit_score,
             e.status,
             e.created_at,
             e.password_hash,
             e.company_id,
             c.name AS company_name,
             w.wallet_address
           FROM employees e
           JOIN wallets w ON e.wallet_id = w.id
           LEFT JOIN companies c ON e.company_id = c.id
           WHERE LOWER(w.wallet_address) = LOWER($1)`,
          [normalized]
        );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Employee access not found");
  }

  return hydrateEmployeeCreditScore(result.rows[0] as ResolvedEmployee);
}

export async function authenticateCompany(input: {
  access: string;
  accessPin: string;
  email?: string;
}) {
  const company = await findCompanyByAccess(input.access);
  const normalizedEmail = (input.email ?? (emailRegex.test(input.access.trim()) ? input.access : undefined))
    ?.trim()
    .toLowerCase();

  if (!company.access_pin_hash) {
    if (!normalizedEmail || normalizedEmail !== company.email.trim().toLowerCase()) {
      throw new ApiError(
        403,
        "This company does not have an access PIN yet. Enter the registered company email and a new PIN to secure it."
      );
    }

    const accessPinHash = await bcrypt.hash(input.accessPin, 12);
    await db.query("UPDATE companies SET access_pin_hash = $1 WHERE id = $2", [accessPinHash, company.id]);
  } else {
    const valid = await bcrypt.compare(input.accessPin, company.access_pin_hash);
    if (!valid) {
      throw new ApiError(401, "Invalid company PIN");
    }
  }

  return sanitizeCompany(company);
}

export async function authenticateEmployee(input: {
  access: string;
  password: string;
  email?: string;
}) {
  const employee = await findEmployeeByAccess(input.access);

  if (employee.status !== "active") {
    throw new ApiError(403, "Employee account is not active. Finish the activation flow first.");
  }

  if (!employee.password_hash) {
    const normalizedEmail = (input.email ?? (emailRegex.test(input.access.trim()) ? input.access : undefined))
      ?.trim()
      .toLowerCase();
    if (!normalizedEmail || !employee.email || normalizedEmail !== employee.email.trim().toLowerCase()) {
      throw new ApiError(
        403,
        "This employee does not have a password yet. Enter the invite email and a new password to secure the account."
      );
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await db.query("UPDATE employees SET password_hash = $1 WHERE id = $2", [passwordHash, employee.id]);
  } else {
    const valid = await bcrypt.compare(input.password, employee.password_hash);
    if (!valid) {
      throw new ApiError(401, "Invalid employee password");
    }
  }

  return sanitizeEmployee(employee);
}

export async function createCompanySession(res: Response, companyId: string) {
  const ttl = await getCompanySessionTimeout(companyId);
  const token = signToken({
    role: "company",
    companyId,
    exp: Date.now() + ttl
  });
  res.cookie(COMPANY_SESSION_COOKIE, token, cookieOptions(ttl));
}

export async function createEmployeeSession(res: Response, employeeId: string, companyId?: string | null) {
  const ttl = await getCompanySessionTimeout(companyId ?? null);
  const token = signToken({
    role: "employee",
    employeeId,
    companyId: companyId ?? null,
    exp: Date.now() + ttl
  });
  res.cookie(EMPLOYEE_SESSION_COOKIE, token, cookieOptions(ttl));
}

export function clearCompanySession(res: Response) {
  res.clearCookie(COMPANY_SESSION_COOKIE, cookieOptions(0));
}

export function clearEmployeeSession(res: Response) {
  res.clearCookie(EMPLOYEE_SESSION_COOKIE, cookieOptions(0));
}

export function readCompanySession(req: Request) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COMPANY_SESSION_COOKIE];
  return token ? verifyToken<CompanySession>(token, "company") : null;
}

export function readEmployeeSession(req: Request) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[EMPLOYEE_SESSION_COOKIE];
  return token ? verifyToken<EmployeeSession>(token, "employee") : null;
}

export async function updateCompanyAccessPin(companyId: string, accessPin: string) {
  const accessPinHash = await bcrypt.hash(accessPin, 12);
  await db.query("UPDATE companies SET access_pin_hash = $1 WHERE id = $2", [accessPinHash, companyId]);
}

export async function requestCompanyRecovery(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new ApiError(400, "Registered email is required");
  }

  const result = await db.query(
    `SELECT id, name, email
     FROM companies
     WHERE LOWER(email) = $1`,
    [normalizedEmail]
  );

  for (const company of result.rows as Array<{ id: string; name: string; email: string }>) {
    const { token, tokenHash, expiresAt } = buildRecoveryTokenRecord();
    await db.query(
      `UPDATE companies
       SET recovery_token_hash = $1, recovery_token_expires_at = $2
       WHERE id = $3`,
      [tokenHash, expiresAt, company.id]
    );

    await sendCompanyRecoveryEmail({
      companyId: company.id,
      companyName: company.name,
      email: company.email,
      resetToken: token,
      resetUrl: getCompanyRecoveryUrl(token)
    });
  }
}

export async function resetCompanyRecovery(token: string, accessPin: string) {
  const tokenHash = hashRecoveryToken(token);
  const result = await db.query(
    `SELECT id
     FROM companies
     WHERE recovery_token_hash = $1
       AND recovery_token_expires_at IS NOT NULL
       AND recovery_token_expires_at > now()
     LIMIT 1`,
    [tokenHash]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Invalid or expired recovery link");
  }

  const companyId = result.rows[0].id as string;
  const accessPinHash = await bcrypt.hash(accessPin, 12);
  await db.query(
    `UPDATE companies
     SET access_pin_hash = $1,
         recovery_token_hash = NULL,
         recovery_token_expires_at = NULL
     WHERE id = $2`,
    [accessPinHash, companyId]
  );

  return getCompanyProfile(companyId);
}

export async function getCompanyProfile(companyId: string) {
  const result = await db.query(
    `SELECT c.id, c.name, c.email, c.created_at, w.wallet_address AS treasury_address, w.chain AS treasury_chain
     FROM companies c
     LEFT JOIN wallets w ON c.treasury_wallet_id = w.id
     WHERE c.id = $1`,
    [companyId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }

  return result.rows[0] as CompanyProfile;
}

export async function getCompanyListForOwner(companyId: string) {
  const company = await getCompanyProfile(companyId);
  return [company];
}

export async function getEmployeeProfile(employeeId: string) {
  const result = await db.query(
    `SELECT
       e.id,
       e.full_name,
       COALESCE(e.email, '') AS email,
       e.salary,
       e.credit_score,
       e.status,
       e.created_at,
       w.wallet_address,
       c.id AS company_id,
       c.name AS company_name
     FROM employees e
     LEFT JOIN wallets w ON e.wallet_id = w.id
     LEFT JOIN companies c ON e.company_id = c.id
     WHERE e.id = $1`,
    [employeeId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Employee not found");
  }

  return hydrateEmployeeCreditScore(result.rows[0] as EmployeeProfile);
}

export async function requestEmployeeRecovery(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new ApiError(400, "Registered email is required");
  }

  const result = await db.query(
    `SELECT id, company_id, full_name, email
     FROM employees
     WHERE LOWER(COALESCE(email, '')) = $1
       AND status = 'active'
     ORDER BY created_at DESC`,
    [normalizedEmail]
  );

  for (const employee of result.rows as Array<{
    id: string;
    company_id: string | null;
    full_name: string;
    email: string;
  }>) {
    const { token, tokenHash, expiresAt } = buildRecoveryTokenRecord();
    await db.query(
      `UPDATE employees
       SET recovery_token_hash = $1, recovery_token_expires_at = $2
       WHERE id = $3`,
      [tokenHash, expiresAt, employee.id]
    );

    await sendEmployeeRecoveryEmail({
      companyId: employee.company_id ?? undefined,
      employeeId: employee.id,
      fullName: employee.full_name,
      email: employee.email,
      resetToken: token,
      resetUrl: getEmployeeRecoveryUrl(token)
    });
  }
}

export async function resetEmployeeRecovery(token: string, password: string) {
  const tokenHash = hashRecoveryToken(token);
  const result = await db.query(
    `SELECT id, company_id
     FROM employees
     WHERE recovery_token_hash = $1
       AND recovery_token_expires_at IS NOT NULL
       AND recovery_token_expires_at > now()
     LIMIT 1`,
    [tokenHash]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Invalid or expired recovery link");
  }

  const employeeId = result.rows[0].id as string;
  const passwordHash = await bcrypt.hash(password, 12);
  await db.query(
    `UPDATE employees
     SET password_hash = $1,
         recovery_token_hash = NULL,
         recovery_token_expires_at = NULL
     WHERE id = $2`,
    [passwordHash, employeeId]
  );

  return getEmployeeProfile(employeeId);
}

export async function isEmployeeOwnedByCompany(employeeId: string, companyId: string) {
  const result = await db.query(
    "SELECT 1 FROM employees WHERE id = $1 AND company_id = $2",
    [employeeId, companyId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function hasCompanyAccessPin(companyId: string) {
  const result = await db.query("SELECT access_pin_hash FROM companies WHERE id = $1", [companyId]);
  if ((result.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }
  return Boolean(result.rows[0].access_pin_hash);
}
