/**
 * Invoice issue and due dates are calendar dates (PostgreSQL `date`), not
 * instants. Clients send `YYYY-MM-DD`; the API also accepts a full ISO
 * timestamp. Turning either into a JS Date makes `2025-01-01` UTC midnight,
 * which reads as 2024-12-31 in local time on a server west of UTC, so both
 * the stored date and the invoice number shifted by a day (or a year).
 *
 * toCalendarDate keeps the date the client wrote: the leading YYYY-MM-DD of
 * a string, ignoring any time or offset. A Date is read in the server's
 * local time; for "today" use businessToday() below.
 */
const LEADING_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

export function calendarDateParts(value: Date | string): CalendarDateParts {
  if (typeof value === 'string') {
    const m = LEADING_DATE.exec(value);
    if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
    value = new Date(value);
  }
  if (isNaN(value.getTime())) {
    throw new RangeError(`Not a date: ${String(value)}`);
  }
  return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
}

/** Local midnight of the calendar date, for display with toLocaleDateString. */
export function calendarDateAsLocal(value: Date | string): Date {
  const { year, month, day } = calendarDateParts(value);
  return new Date(year, month - 1, day);
}

/** `YYYY-MM-DD` for a `date` column, without a timezone shift. */
export function toCalendarDate(value: Date | string): string {
  const { year, month, day } = calendarDateParts(value);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * "Today" for date-only invoice values (default issue date, recurring runs,
 * overdue) is the calendar date in the business timezone: BUSINESS_TIMEZONE,
 * an IANA identifier such as America/New_York. Unset, it is the process's
 * local timezone (TZ of the process or container), as before. Stored dates
 * are never shifted; absolute timestamps (createdAt, tokens, audit) stay UTC
 * instants and do not use this.
 */
export function assertBusinessTimezone(raw: string | undefined): string | undefined {
  const zone = (raw ?? '').trim();
  if (!zone) return undefined;
  // Intl also accepts UTC offsets such as +05:00; an offset is not a place
  // and has no daylight-saving rules, so only named zones are allowed.
  let valid = !/^[+-]/.test(zone);
  if (valid) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    throw new Error(`BUSINESS_TIMEZONE must be an IANA time zone such as America/New_York or UTC, got '${zone}'`);
  }
  return zone;
}

/** `YYYY-MM-DD` of `now` in the business timezone (see assertBusinessTimezone). */
export function businessToday(now: Date = new Date()): string {
  const zone = assertBusinessTimezone(process.env.BUSINESS_TIMEZONE);
  if (!zone) return toCalendarDate(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function fromUtcDay(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Pure calendar arithmetic on `YYYY-MM-DD`: no timezone, no DST. */
export function addCalendarDays(date: string, days: number): string {
  const { year, month, day } = calendarDateParts(date);
  return fromUtcDay(Date.UTC(year, month - 1, day + days));
}

/**
 * Months on `YYYY-MM-DD`. A day past the end of the target month rolls over
 * (Jan 31 + 1 month = Mar 3, or Mar 2 in a leap year), like Date#setMonth.
 */
export function addCalendarMonths(date: string, months: number): string {
  const { year, month, day } = calendarDateParts(date);
  return fromUtcDay(Date.UTC(year, month - 1 + months, day));
}
