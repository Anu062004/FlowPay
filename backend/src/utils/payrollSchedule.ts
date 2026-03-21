const DEFAULT_COMPANY_TIME_ZONE = "Europe/London";

const COMPANY_TIME_ZONE_ALIASES: Record<string, string> = {
  "UTC+0 - London": "Europe/London",
  "UTC-5 - New York": "America/New_York",
  "UTC-8 - San Francisco": "America/Los_Angeles",
  "UTC+5:30 - Mumbai": "Asia/Kolkata",
  "Europe/London": "Europe/London",
  "America/New_York": "America/New_York",
  "America/Los_Angeles": "America/Los_Angeles",
  "Asia/Kolkata": "Asia/Kolkata",
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type PayrollSchedule =
  | { mode: "manual"; label: string }
  | { mode: "monthly_day"; label: string; dayOfMonth: number }
  | { mode: "last_day"; label: string };

function toOrdinal(day: number) {
  const mod10 = day % 10;
  const mod100 = day % 100;
  if (mod10 === 1 && mod100 !== 11) return `${day}st`;
  if (mod10 === 2 && mod100 !== 12) return `${day}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${day}rd`;
  return `${day}th`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function normalizeCompanyTimeZone(value?: string | null) {
  const candidate = value?.trim();
  if (!candidate) {
    return DEFAULT_COMPANY_TIME_ZONE;
  }

  return COMPANY_TIME_ZONE_ALIASES[candidate] ?? DEFAULT_COMPANY_TIME_ZONE;
}

export function getTimeZoneDateParts(referenceDate: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(referenceDate)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

  const normalizedHour = values.hour === "24" ? "00" : values.hour;

  return {
    year: parseInt(values.year, 10),
    month: parseInt(values.month, 10),
    day: parseInt(values.day, 10),
    hour: parseInt(normalizedHour, 10),
    minute: parseInt(values.minute, 10),
  };
}

function getLastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getScheduledDayForMonth(schedule: PayrollSchedule, year: number, month: number) {
  if (schedule.mode === "manual") {
    return null;
  }
  if (schedule.mode === "last_day") {
    return getLastDayOfMonth(year, month);
  }
  return schedule.dayOfMonth;
}

function getNextMonth(year: number, month: number) {
  if (month === 12) {
    return { year: year + 1, month: 1 };
  }
  return { year, month: month + 1 };
}

function getTimeZoneOffsetMinutes(referenceDate: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timeZoneName =
    formatter.formatToParts(referenceDate).find((part) => part.type === "timeZoneName")?.value ??
    "GMT";

  if (timeZoneName === "GMT" || timeZoneName === "UTC") {
    return 0;
  }

  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

function getUtcDateForLocalTime(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
) {
  let utcMillis = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    const adjustedMillis =
      Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) -
      offsetMinutes * 60 * 1000;
    if (adjustedMillis === utcMillis) {
      break;
    }
    utcMillis = adjustedMillis;
  }
  return new Date(utcMillis);
}

export function canonicalizePayrollDayLabel(
  value: string | undefined | null,
  options?: {
    referenceDate?: Date;
    timeZone?: string;
  }
) {
  const referenceDate = options?.referenceDate ?? new Date();
  const timeZone = normalizeCompanyTimeZone(options?.timeZone);
  const raw = value?.trim();
  if (!raw) {
    return "15th of each month";
  }

  const normalized = raw.toLowerCase();
  if (normalized === "manual only") {
    return "Manual only";
  }
  if (normalized === "1st of each month") {
    return "1st of each month";
  }
  if (normalized === "15th of each month") {
    return "15th of each month";
  }
  if (normalized === "last day of month") {
    return "Last day of month";
  }

  const customMatch = raw.match(/(\d+)(st|nd|rd|th) of each month/i);
  if (customMatch) {
    const day = Math.min(Math.max(parseInt(customMatch[1], 10), 1), 28);
    return `${toOrdinal(day)} of each month`;
  }

  if (normalized === "today only") {
    const local = getTimeZoneDateParts(referenceDate, timeZone);
    return `${toOrdinal(local.day)} of each month`;
  }

  // Weekly and bi-weekly payroll are not supported by the current monthly salary model.
  return "Manual only";
}

export function parsePayrollScheduleLabel(label: string): PayrollSchedule {
  const normalized = label.trim().toLowerCase();
  if (normalized === "manual only") {
    return { mode: "manual", label: "Manual only" };
  }
  if (normalized === "last day of month") {
    return { mode: "last_day", label: "Last day of month" };
  }

  const customMatch = label.match(/(\d+)(st|nd|rd|th) of each month/i);
  if (customMatch) {
    const dayOfMonth = Math.min(Math.max(parseInt(customMatch[1], 10), 1), 28);
    return {
      mode: "monthly_day",
      label: `${toOrdinal(dayOfMonth)} of each month`,
      dayOfMonth,
    };
  }

  return { mode: "monthly_day", label: "15th of each month", dayOfMonth: 15 };
}

export function formatPayrollMonthKey(referenceDate: Date, timeZone: string) {
  const local = getTimeZoneDateParts(referenceDate, timeZone);
  return `${local.year}-${pad(local.month)}-01`;
}

export function formatPayrollMonthLabel(referenceDate: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(referenceDate);
}

export function getNextPayrollRun(options: {
  payrollDayLabel: string;
  companyTimeZone: string;
  referenceDate?: Date;
  runHourLocal?: number;
  runMinuteLocal?: number;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const timeZone = normalizeCompanyTimeZone(options.companyTimeZone);
  const schedule = parsePayrollScheduleLabel(options.payrollDayLabel);

  if (schedule.mode === "manual") {
    return null;
  }

  const runHourLocal = options.runHourLocal ?? 9;
  const runMinuteLocal = options.runMinuteLocal ?? 0;
  const local = getTimeZoneDateParts(referenceDate, timeZone);

  let year = local.year;
  let month = local.month;
  let scheduledDay = getScheduledDayForMonth(schedule, year, month);
  let runAt =
    scheduledDay === null
      ? null
      : getUtcDateForLocalTime(
          {
            year,
            month,
            day: scheduledDay,
            hour: runHourLocal,
            minute: runMinuteLocal,
          },
          timeZone
        );

  if (!runAt || runAt.getTime() <= referenceDate.getTime()) {
    const nextMonth = getNextMonth(year, month);
    year = nextMonth.year;
    month = nextMonth.month;
    scheduledDay = getScheduledDayForMonth(schedule, year, month);
    runAt =
      scheduledDay === null
        ? null
        : getUtcDateForLocalTime(
            {
              year,
              month,
              day: scheduledDay,
              hour: runHourLocal,
              minute: runMinuteLocal,
            },
            timeZone
          );
  }

  if (!runAt || scheduledDay === null) {
    return null;
  }

  return {
    schedule,
    timeZone,
    scheduledDay,
    payrollMonthKey: `${year}-${pad(month)}-01`,
    payrollMonthLabel: formatPayrollMonthLabel(runAt, timeZone),
    runAt,
    hoursUntilRun: (runAt.getTime() - referenceDate.getTime()) / (1000 * 60 * 60),
  };
}

export function getPayrollScheduleStatus(options: {
  payrollDayLabel: string;
  companyTimeZone: string;
  referenceDate?: Date;
  runHourLocal?: number;
  runMinuteLocal?: number;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const timeZone = normalizeCompanyTimeZone(options.companyTimeZone);
  const schedule = parsePayrollScheduleLabel(options.payrollDayLabel);
  const local = getTimeZoneDateParts(referenceDate, timeZone);
  const runHourLocal = options.runHourLocal ?? 9;
  const runMinuteLocal = options.runMinuteLocal ?? 0;

  const scheduledDay = getScheduledDayForMonth(schedule, local.year, local.month);

  const due =
    schedule.mode !== "manual" &&
    scheduledDay !== null &&
    (local.day > scheduledDay ||
      (local.day === scheduledDay &&
        (local.hour > runHourLocal ||
          (local.hour === runHourLocal && local.minute >= runMinuteLocal))));

  return {
    due,
    schedule,
    scheduledDay,
    local,
    timeZone,
    payrollMonthKey: formatPayrollMonthKey(referenceDate, timeZone),
    payrollMonthLabel: formatPayrollMonthLabel(referenceDate, timeZone),
  };
}
