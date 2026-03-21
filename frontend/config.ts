// ============================================================================
// Configuration File for FlowPay Website
// ============================================================================
// FlowPay - Policy-controlled, OpenClaw-orchestrated financial operating system

// Hero Section Configuration
export interface HeroConfig {
  subtitle: string;
  titleLine1: string;
  titleLine2: string;
  tagline: string;
  ctaText: string;
  secondaryCta: string;
  heroImage: string;
}

export const heroConfig: HeroConfig = {
  subtitle: "AUTONOMOUS PAYROLL",
  titleLine1: "Payroll that",
  titleLine2: "runs itself.",
  tagline: "Schedule once. FlowPay executes on time, in your treasury rules, with full audit history.",
  ctaText: "Create Employer Wallet",
  secondaryCta: "Use Existing Employer Wallet",
  heroImage: "images/hero_office_v2.jpg",
};

// Feature Section Configuration (Section 2)
export interface FeatureConfig {
  headline: string;
  body: string;
  cardLabel: string;
  cardTitle: string;
  cardBody: string;
  featureImage: string;
}

export const featureConfig: FeatureConfig = {
  headline: "Smart execution.",
  body: "Rules, limits, and approvals encoded into every run. No manual checks. No missed cuts.",
  cardLabel: "CASHFLOW",
  cardTitle: "Never miss a payday",
  cardBody: "Auto-reserves, retry logic, and instant failure alerts.",
  featureImage: "images/feature_cashflow.jpg",
};

// Pillars Section Configuration (Section 3)
export interface PillarCard {
  title: string;
  body: string;
  image: string;
}

export interface PillarsConfig {
  headline: string;
  cards: PillarCard[];
}

export const pillarsConfig: PillarsConfig = {
  headline: "One platform. Three pillars.",
  cards: [
    {
      title: "Treasury",
      body: "Multi-account visibility, real-time balances, and automated allocation.",
      image: "images/pillar_treasury.jpg",
    },
    {
      title: "Payroll",
      body: "Scheduled runs, tax-ready exports, and on-time delivery.",
      image: "images/pillar_payroll.jpg",
    },
    {
      title: "Compliance",
      body: "Immutable logs, policy enforcement, and audit-ready trails.",
      image: "images/pillar_compliance.jpg",
    },
  ],
};

// Full Bleed Section Configuration (Sections 4, 7, 10)
export interface FullBleedConfig {
  headline: string;
  body: string;
  cta?: string;
  image: string;
}

export const trustConfig: FullBleedConfig = {
  headline: "Built for team trust.",
  body: "Clear history. Transparent rules. Employees see status; admins see control.",
  image: "images/trust_portrait.jpg",
};

export const securityConfig: FullBleedConfig = {
  headline: "Security built in.",
  body: "Encryption at rest and in transit. Role-based access. Audit logs you can actually read.",
  image: "images/security_portrait.jpg",
};

export const onchainConfig: FullBleedConfig = {
  headline: "On-chain. Human-simple.",
  body: "Wallets, approvals, and payouts—abstracted into a clean interface your team can actually use.",
  image: "images/onchain_portrait.jpg",
};

// Two-Up Section Configuration (Sections 5, 6, 8, 9)
export interface TwoUpConfig {
  headline: string;
  body: string;
  microLabel?: string;
  cta?: string;
  image: string;
  reversed: boolean;
}

export const scaleConfig: TwoUpConfig = {
  headline: "Scale without chaos.",
  body: "Add entities, currencies, and schedules without adding overhead.",
  microLabel: "99.97% UPTIME",
  image: "images/scale_meeting.jpg",
  reversed: false,
};

export const controlConfig: TwoUpConfig = {
  headline: "Control without friction.",
  body: "Set policies once. Let the system enforce limits, approvals, and alerts—automatically.",
  image: "images/control_laptop.jpg",
  reversed: true,
};

export const complianceConfig: TwoUpConfig = {
  headline: "Compliance by default.",
  body: "Retention rules, exportable trails, and policy checks before every execution.",
  microLabel: "AUDIT-READY",
  image: "images/compliance_desk.jpg",
  reversed: false,
};

export const insightsConfig: TwoUpConfig = {
  headline: "Insights in real time.",
  body: "See cashflow, obligations, and risks in one view—before they become surprises.",
  image: "images/insights_workspace.jpg",
  reversed: true,
};

// Closing CTA Section Configuration (Section 11)
export interface ClosingConfig {
  headline: string;
  body: string;
  ctaText: string;
  secondaryCta: string;
  image: string;
}

export const closingConfig: ClosingConfig = {
  headline: "Ready to automate payroll?",
  body: "Get a demo tailored to your treasury setup. Implementation support included.",
  ctaText: "Enter FlowPay",
  secondaryCta: "",
  image: "images/closing_chat.jpg",
};

// Footer Section Configuration (Section 12)
export interface FooterConfig {
  title: string;
  email: string;
  offices: string;
  formLabels: {
    name: string;
    email: string;
    company: string;
    message: string;
    submit: string;
  };
  navLinks: Array<{ label: string; href: string }>;
  legalLinks: Array<{ label: string; href: string }>;
  copyright: string;
}

export const footerConfig: FooterConfig = {
  title: "Let's build your payroll flow.",
  email: "hello@flowpay.io",
  offices: "San Francisco · Singapore · Berlin",
  formLabels: {
    name: "Name",
    email: "Email",
    company: "Company",
    message: "Message",
    submit: "Send message",
  },
  navLinks: [
    { label: "Product", href: "#product" },
    { label: "Security", href: "#security" },
    { label: "Pricing", href: "#pricing" },
    { label: "Docs", href: "#docs" },
  ],
  legalLinks: [
    { label: "Privacy", href: "#privacy" },
    { label: "Terms", href: "#terms" },
  ],
  copyright: "© FlowPay 2026",
};

// Site Metadata
export interface SiteConfig {
  title: string;
  description: string;
  language: string;
}

export const siteConfig: SiteConfig = {
  title: "FlowPay - Autonomous Payroll & Treasury",
  description: "FlowPay is a policy-controlled, OpenClaw-orchestrated financial operating system where treasury, payroll, lending, and wallet execution work together as one product.",
  language: "en",
};

// Navigation Configuration
export interface NavConfig {
  logo: string;
  links: Array<{ label: string; href: string }>;
  cta: string;
}

export const navConfig: NavConfig = {
  logo: "FlowPay",
  links: [
    { label: "Product", href: "#product" },
    { label: "Security", href: "#security" },
    { label: "Pricing", href: "#pricing" },
    { label: "Docs", href: "#docs" },
  ],
  cta: "Request demo",
};
