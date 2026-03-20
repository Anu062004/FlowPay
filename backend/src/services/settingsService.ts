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
    accessPinConfigured?: boolean;
  };
  agent: {
    enabled: boolean;
    executionSource: string;
    slippageProtection: boolean;
    maxTradeSize: number;
    riskTolerance: string;
    rebalanceFrequency: string;
    lending_paused?: boolean;
    walletPolicy: {
      allowTreasuryAllocation: boolean;
      allowLoanDisbursal: boolean;
      allowPayroll: boolean;
      allowAaveRebalance: boolean;
      maxSingleTransfer: number;
      maxDailyOutflow: number;
      maxLoanAmount: number;
      maxAaveAllocationPct: number;
      humanReviewAbove: number;
    };
  };
};

function buildDefaultSettings(companyName: string, companyEmail: string): CompanySettings {
  return {
    profile: {
      companyName,
      legalEntity: "",
      companyEmail,
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
      executionSource: "OpenClaw EC2",
      slippageProtection: true,
      maxTradeSize: 50000,
      riskTolerance: "Conservative",
      rebalanceFrequency: "Weekly",
      lending_paused: false,
      walletPolicy: {
        allowTreasuryAllocation: true,
        allowLoanDisbursal: true,
        allowPayroll: true,
        allowAaveRebalance: true,
        maxSingleTransfer: 2500,
        maxDailyOutflow: 10000,
        maxLoanAmount: 1500,
        maxAaveAllocationPct: 35,
        humanReviewAbove: 750
      }
    }
  };
}

function normalizeSettings(
  raw: Partial<CompanySettings> | undefined,
  companyName: string,
  companyEmail: string,
  accessPinConfigured: boolean
): CompanySettings {
  const defaults = buildDefaultSettings(companyName, companyEmail);
  const next = raw ?? {};

  return {
    profile: {
      ...defaults.profile,
      ...(next.profile ?? {})
    },
    payroll: {
      ...defaults.payroll,
      ...(next.payroll ?? {})
    },
    security: {
      ...defaults.security,
      ...(next.security ?? {}),
      accessPinConfigured
    },
    agent: {
      ...defaults.agent,
      ...(next.agent ?? {}),
      walletPolicy: {
        ...defaults.agent.walletPolicy,
        ...(next.agent?.walletPolicy ?? {})
      },
      lending_paused: next.agent?.lending_paused ?? defaults.agent.lending_paused
    }
  };
}

export async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const company = await db.query("SELECT id, name, email, access_pin_hash FROM companies WHERE id = $1", [companyId]);
  if ((company.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }

  const existing = await db.query(
    "SELECT profile, payroll, security, agent FROM company_settings WHERE company_id = $1",
    [companyId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return normalizeSettings(
      existing.rows[0] as Partial<CompanySettings>,
      company.rows[0].name,
      company.rows[0].email,
      Boolean(company.rows[0].access_pin_hash)
    );
  }

  const defaults = buildDefaultSettings(company.rows[0].name, company.rows[0].email);
  const inserted = await db.query(
    `INSERT INTO company_settings (company_id, profile, payroll, security, agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING profile, payroll, security, agent`,
    [companyId, defaults.profile, defaults.payroll, defaults.security, defaults.agent]
  );

  return normalizeSettings(
    inserted.rows[0] as Partial<CompanySettings>,
    company.rows[0].name,
    company.rows[0].email,
    Boolean(company.rows[0].access_pin_hash)
  );
}

export async function upsertCompanySettings(
  companyId: string,
  settings: CompanySettings
): Promise<CompanySettings> {
  const company = await db.query("SELECT id, email, access_pin_hash FROM companies WHERE id = $1", [companyId]);
  if ((company.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }

  const canonicalEmail = settings.profile.companyEmail || company.rows[0].email;
  const normalized = normalizeSettings(
    {
      ...settings,
      profile: {
        ...settings.profile,
        companyEmail: canonicalEmail
      }
    },
    settings.profile.companyName,
    canonicalEmail,
    Boolean(company.rows[0].access_pin_hash)
  );
  const nextSettings: CompanySettings = {
    ...normalized,
    security: {
      ...normalized.security,
      accessPinConfigured: undefined
    }
  };

  await db.query(
    "UPDATE companies SET name = $1, email = $2 WHERE id = $3",
    [nextSettings.profile.companyName, canonicalEmail, companyId]
  );

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
    [companyId, nextSettings.profile, nextSettings.payroll, nextSettings.security, nextSettings.agent]
  );

  return normalizeSettings(
    result.rows[0] as Partial<CompanySettings>,
    nextSettings.profile.companyName,
    canonicalEmail,
    Boolean(company.rows[0].access_pin_hash)
  );
}
