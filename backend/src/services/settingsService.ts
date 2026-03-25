import { db } from "../db/pool.js";
import { ApiError } from "../utils/errors.js";
import {
  canonicalizePayrollDayLabel,
  normalizeCompanyTimeZone,
} from "../utils/payrollSchedule.js";
import { applyCompanySettlementChain, getCompanySettlementSummary } from "./companySettlementService.js";
import { getDefaultSettlementChain, normalizeSettlementChain, type SettlementChain } from "../utils/settlement.js";

export type CompanySettings = {
  profile: {
    companyName: string;
    legalEntity: string;
    companyEmail: string;
    timeZone: string;
  };
  settlement: {
    chain: SettlementChain;
    switchAllowed?: boolean;
    switchBlockedReason?: string | null;
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
  updated_at?: string;
};

function buildDefaultSettings(
  companyName: string,
  companyEmail: string,
  settlementChain: SettlementChain
): CompanySettings {
  return {
    profile: {
      companyName,
      legalEntity: "",
      companyEmail,
      timeZone: "Europe/London"
    },
    settlement: {
      chain: settlementChain
    },
    payroll: {
      payrollDay: "15th of each month",
      currency: settlementChain === "polygon" ? "USDT on Polygon" : "USDT on Ethereum",
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
  accessPinConfigured: boolean,
  settlementChain: SettlementChain,
  switchAllowed = true,
  switchBlockedReason: string | null = null,
  settingsUpdatedAt?: string | null
): CompanySettings {
  const defaults = buildDefaultSettings(companyName, companyEmail, settlementChain);
  const next = raw ?? {};
  const normalizedTimeZone = normalizeCompanyTimeZone(next.profile?.timeZone ?? defaults.profile.timeZone);
  const payrollReferenceDate = settingsUpdatedAt ? new Date(settingsUpdatedAt) : new Date();
  const normalizedSettlementChain = normalizeSettlementChain(
    next.settlement?.chain,
    settlementChain
  );
  const normalizedCurrency = (next.payroll?.currency ?? defaults.payroll.currency).toLowerCase().includes("polygon")
    ? "USDT on Polygon"
    : normalizedSettlementChain === "polygon"
      ? "USDT on Polygon"
      : "USDT on Ethereum";

  return {
    profile: {
      ...defaults.profile,
      ...(next.profile ?? {}),
      timeZone: normalizedTimeZone
    },
    settlement: {
      chain: normalizedSettlementChain,
      switchAllowed,
      switchBlockedReason
    },
    payroll: {
      ...defaults.payroll,
      ...(next.payroll ?? {}),
      currency: normalizedCurrency,
      payrollDay: canonicalizePayrollDayLabel(next.payroll?.payrollDay ?? defaults.payroll.payrollDay, {
        referenceDate: payrollReferenceDate,
        timeZone: normalizedTimeZone
      })
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
    },
    updated_at: settingsUpdatedAt ? new Date(settingsUpdatedAt).toISOString() : undefined
  };
}

export async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const company = await db.query(
    `SELECT
       c.id,
       c.name,
       c.email,
       c.access_pin_hash,
       w.chain AS treasury_chain
     FROM companies c
     LEFT JOIN wallets w ON w.id = c.treasury_wallet_id
     WHERE c.id = $1`,
    [companyId]
  );
  if ((company.rowCount ?? 0) === 0) {
    throw new ApiError(404, "Company not found");
  }
  const settlement = await getCompanySettlementSummary(companyId);
  const settlementChain = normalizeSettlementChain(
    company.rows[0].treasury_chain ?? settlement.chain,
    getDefaultSettlementChain()
  );

  const existing = await db.query(
    "SELECT profile, settlement, payroll, security, agent, updated_at FROM company_settings WHERE company_id = $1",
    [companyId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return normalizeSettings(
      existing.rows[0] as Partial<CompanySettings>,
      company.rows[0].name,
      company.rows[0].email,
      Boolean(company.rows[0].access_pin_hash),
      settlementChain,
      settlement.switchAllowed,
      settlement.switchBlockedReason,
      existing.rows[0].updated_at ?? null
    );
  }

  const defaults = buildDefaultSettings(company.rows[0].name, company.rows[0].email, settlementChain);
  const inserted = await db.query(
    `INSERT INTO company_settings (company_id, profile, settlement, payroll, security, agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING profile, settlement, payroll, security, agent, updated_at`,
    [companyId, defaults.profile, defaults.settlement, defaults.payroll, defaults.security, defaults.agent]
  );

  return normalizeSettings(
    inserted.rows[0] as Partial<CompanySettings>,
    company.rows[0].name,
    company.rows[0].email,
    Boolean(company.rows[0].access_pin_hash),
    settlementChain,
    settlement.switchAllowed,
    settlement.switchBlockedReason,
    inserted.rows[0].updated_at ?? null
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
  const currentSettlement = await getCompanySettlementSummary(companyId);
  const requestedSettlementChain = normalizeSettlementChain(settings.settlement?.chain, currentSettlement.chain);
  await applyCompanySettlementChain(companyId, requestedSettlementChain);

  const canonicalEmail = settings.profile.companyEmail || company.rows[0].email;
  const normalized = normalizeSettings(
    {
      ...settings,
      settlement: {
        chain: requestedSettlementChain
      },
      profile: {
        ...settings.profile,
        companyEmail: canonicalEmail,
        timeZone: normalizeCompanyTimeZone(settings.profile.timeZone)
      }
    },
    settings.profile.companyName,
    canonicalEmail,
    Boolean(company.rows[0].access_pin_hash),
    requestedSettlementChain,
    currentSettlement.switchAllowed,
    currentSettlement.switchBlockedReason,
    settings.updated_at ?? null
  );
  const nextSettings: CompanySettings = {
    ...normalized,
    settlement: {
      chain: normalized.settlement.chain
    },
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
    `INSERT INTO company_settings (company_id, profile, settlement, payroll, security, agent, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (company_id) DO UPDATE SET
       profile = EXCLUDED.profile,
       settlement = EXCLUDED.settlement,
       payroll = EXCLUDED.payroll,
       security = EXCLUDED.security,
       agent = EXCLUDED.agent,
       updated_at = now()
     RETURNING profile, settlement, payroll, security, agent, updated_at`,
    [companyId, nextSettings.profile, nextSettings.settlement, nextSettings.payroll, nextSettings.security, nextSettings.agent]
  );
  const nextSettlement = await getCompanySettlementSummary(companyId);

  return normalizeSettings(
    result.rows[0] as Partial<CompanySettings>,
    nextSettings.profile.companyName,
    canonicalEmail,
    Boolean(company.rows[0].access_pin_hash),
    requestedSettlementChain,
    nextSettlement.switchAllowed,
    nextSettlement.switchBlockedReason,
    result.rows[0].updated_at ?? null
  );
}
