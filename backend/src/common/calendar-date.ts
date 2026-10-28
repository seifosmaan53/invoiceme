/**
 * Invoice issue and due dates are calendar dates (PostgreSQL `date`), not
 * instants. Clients send `YYYY-MM-DD`; the API also accepts a full ISO
 * timestamp. Turning either into a JS Date makes `2025-01-01` UTC midnight,
 * which reads as 2024-12-31 in local time on a server west of UTC, so both
 * the stored date and the invoice number shifted by a day (or a year).
 *
 * toCalendarDate keeps the date the client wrote: the leading YYYY-MM-DD of
 * a string, ignoring any time or offset. A Date (for example `new Date()`
 * for "today") is read in the server's local time, as before.
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

/** `YYYY-MM-DD` for a `date` column, without a timezone shift. */
export function toCalendarDate(value: Date | string): string {
  const { year, month, day } = calendarDateParts(value);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
