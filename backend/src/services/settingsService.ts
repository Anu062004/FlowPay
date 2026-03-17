import { db } from "../db/pool.js";
import { ApiError } from "../utils/errors.js";

export type CompanySettings = {
  profile: {
    companyName: string;
    legalEntity: string;
    companyEmail: string;
    timeZone: string;
  };
  payroll: {
    payrollDay: string;
    currency: string;
    autoProcess: boolean;
    emiAutoDeduction: boolean;
    emailNotifications: boolean;
  };
  security: {
    twoFactor: boolean;
    transactionApproval: boolean;
    ipAllowlist: boolean;
    auditLog: boolean;
    sessionTimeout: string;
  };
  agent: {
    enabled: boolean;
    slippageProtection: boolean;
    maxTradeSize: number;
    riskTolerance: string;
    rebalanceFrequency: string;
    lending_paused?: boolean;
  };
};

function buildDefaultSettings(companyName: string): CompanySettings {
  return {
    profile: {
      companyName,
      legalEntity: "",
      companyEmail: "",
      timeZone: "UTC+0 - London"
    },
    payroll: {
      payrollDay: "15th of each month",
      currency: "USDC",
      autoProcess: true,
      emiAutoDeduction: true,
      emailNotifications: true
    },
    security: {
      twoFactor: true,
      transactionApproval: true,
      ipAllowlist: false,
      auditLog: true,
      sessionTimeout: "30 minutes"
    },
    agent: {
      enabled: true,
      slippageProtection: true,
      maxTradeSize: 50000,
      riskTolerance: "Conservative",
      rebalanceFrequency: "Weekly",
      lending_paused: false
    }
  };
}

export async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const company = await db.query("SELECT id, name FROM companies WHERE id = $1", [companyId]);
  if ((company.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }

  const existing = await db.query(
    "SELECT profile, payroll, security, agent FROM company_settings WHERE company_id = $1",
    [companyId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return existing.rows[0] as CompanySettings;
  }

  const defaults = buildDefaultSettings(company.rows[0].name);
  const inserted = await db.query(
    `INSERT INTO company_settings (company_id, profile, payroll, security, agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING profile, payroll, security, agent`,
    [companyId, defaults.profile, defaults.payroll, defaults.security, defaults.agent]
  );

  return inserted.rows[0] as CompanySettings;
}

export async function upsertCompanySettings(
  companyId: string,
  settings: CompanySettings
): Promise<CompanySettings> {
  const company = await db.query("SELECT id FROM companies WHERE id = $1", [companyId]);
  if ((company.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }

  const result = await db.query(
    `INSERT INTO company_settings (company_id, profile, payroll, security, agent, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (company_id) DO UPDATE SET
       profile = EXCLUDED.profile,
       payroll = EXCLUDED.payroll,
       security = EXCLUDED.security,
       agent = EXCLUDED.agent,
       updated_at = now()
     RETURNING profile, payroll, security, agent`,
    [companyId, settings.profile, settings.payroll, settings.security, settings.agent]
  );

  return result.rows[0] as CompanySettings;
}
