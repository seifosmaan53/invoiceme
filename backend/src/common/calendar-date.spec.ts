import {
  addCalendarDays,
  addCalendarMonths,
  assertBusinessTimezone,
  businessToday,
  calendarDateAsLocal,
  calendarDateParts,
  toCalendarDate,
} from './calendar-date';
import { execFileSync } from 'child_process';
import * as path from 'path';

/**
 * Runs `expression` (with the module bound to `c`) in a fresh Node process
 * whose real TZ is `tz`: Jest sandboxes process.env, so assigning TZ inside a
 * test does not change the clock's local timezone.
 */
function inProcessTz(tz: string, env: Record<string, string>, expression: string): unknown {
  const out = execFileSync(
    process.execPath,
    [
      '-r',
      'ts-node/register/transpile-only',
      '-e',
      `const c = require(${JSON.stringify(path.join(__dirname, 'calendar-date'))});` +
        `process.stdout.write(JSON.stringify(${expression}))`,
    ],
    { env: { PATH: process.env.PATH ?? '', ...env, TZ: tz }, encoding: 'utf8' },
  );
  return JSON.parse(out);
}

describe('calendar dates', () => {
  it('keeps the date written in a string, ignoring time and offset', () => {
    expect(toCalendarDate('2025-01-01')).toBe('2025-01-01');
    expect(toCalendarDate('2025-11-23T00:00:00Z')).toBe('2025-11-23');
    expect(toCalendarDate('2025-12-31T23:30:00-05:00')).toBe('2025-12-31');
    expect(calendarDateParts('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('reads a Date in local time', () => {
    expect(toCalendarDate(new Date(2025, 0, 1, 0, 0))).toBe('2025-01-01');
    expect(toCalendarDate(new Date(2025, 0, 1, 23, 59))).toBe('2025-01-01');
  });

  it('gives local midnight of the written date for display', () => {
    const d = calendarDateAsLocal('2025-01-01');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2025, 0, 1, 0]);
  });

  it('refuses something that is not a date', () => {
    expect(() => toCalendarDate('not a date')).toThrow(RangeError);
  });
});

describe('business "today" (BUSINESS_TIMEZONE)', () => {
  const savedZone = process.env.BUSINESS_TIMEZONE;

  beforeAll(() => jest.useFakeTimers());
  afterAll(() => jest.useRealTimers());
  afterEach(() => {
    if (savedZone === undefined) delete process.env.BUSINESS_TIMEZONE;
    else process.env.BUSINESS_TIMEZONE = savedZone;
  });

  /** businessToday() on a fixed clock at `instant` (UTC). */
  function todayAt(zone: string | undefined, instant: string): string {
    if (zone === undefined) delete process.env.BUSINESS_TIMEZONE;
    else process.env.BUSINESS_TIMEZONE = zone;
    jest.setSystemTime(new Date(instant));
    const fromClock = businessToday();
    expect(businessToday(new Date(instant))).toBe(fromClock);
    return fromClock;
  }

  // [zone, last instant of 2026-10-28 there, first instant of 2026-10-29 there]
  it.each([
    ['UTC', '2026-10-28T23:59:59.999Z', '2026-10-29T00:00:00.000Z'],
    ['America/New_York', '2026-10-29T03:59:59.999Z', '2026-10-29T04:00:00.000Z'],
    ['Asia/Tokyo', '2026-10-28T14:59:59.999Z', '2026-10-28T15:00:00.000Z'],
    ['Pacific/Kiritimati', '2026-10-28T09:59:59.999Z', '2026-10-28T10:00:00.000Z'],
  ])('%s: the date changes at local midnight', (zone, before, after) => {
    expect(todayAt(zone, before)).toBe('2026-10-28');
    expect(todayAt(zone, after)).toBe('2026-10-29');
  });

  it('America/New_York across the 2026 DST changes', () => {
    const ny = 'America/New_York';
    // 2026-03-08 starts in EST (-5): midnight is 05:00Z; 2026-03-09 is EDT (-4): midnight 04:00Z
    expect(todayAt(ny, '2026-03-08T04:59:59Z')).toBe('2026-03-07');
    expect(todayAt(ny, '2026-03-08T05:00:00Z')).toBe('2026-03-08');
    expect(todayAt(ny, '2026-03-09T03:59:59Z')).toBe('2026-03-08');
    expect(todayAt(ny, '2026-03-09T04:00:00Z')).toBe('2026-03-09');
    // 2026-11-01 starts in EDT: midnight 04:00Z; 2026-11-02 is EST: midnight 05:00Z
    expect(todayAt(ny, '2026-11-01T03:59:59Z')).toBe('2026-10-31');
    expect(todayAt(ny, '2026-11-01T04:00:00Z')).toBe('2026-11-01');
    expect(todayAt(ny, '2026-11-02T04:59:59Z')).toBe('2026-11-01');
    expect(todayAt(ny, '2026-11-02T05:00:00Z')).toBe('2026-11-02');
  });

  it('is independent of the process timezone when set', () => {
    const at = (tz: string, zone: string, instant: string) =>
      inProcessTz(tz, { BUSINESS_TIMEZONE: zone }, `c.businessToday(new Date('${instant}'))`);
    expect(at('Asia/Tokyo', 'America/New_York', '2026-10-29T02:00:00Z')).toBe('2026-10-28');
    expect(at('America/New_York', 'Asia/Tokyo', '2026-10-28T16:00:00Z')).toBe('2026-10-29');
  });

  it('unset or blank falls back to the process local timezone (TZ)', () => {
    const at = (env: Record<string, string>, instant: string) =>
      inProcessTz('America/New_York', env, `c.businessToday(new Date('${instant}'))`);
    expect(at({}, '2026-10-29T03:59:59Z')).toBe('2026-10-28');
    expect(at({}, '2026-10-29T04:00:00Z')).toBe('2026-10-29');
    expect(at({ BUSINESS_TIMEZONE: '  ' }, '2026-10-29T03:59:59Z')).toBe('2026-10-28');
    // and, in this process, unset means whatever local time says
    expect(todayAt(undefined, '2026-10-29T03:59:59Z')).toBe(toCalendarDate(new Date('2026-10-29T03:59:59Z')));
    expect(assertBusinessTimezone(undefined)).toBeUndefined();
    expect(assertBusinessTimezone('')).toBeUndefined();
  });

  it.each(['Mars/Olympus_Mons', 'America/NewYork', 'New York', '+05:00', '-0500'])(
    'rejects %p',
    (zone) => {
      expect(() => assertBusinessTimezone(zone)).toThrow(/BUSINESS_TIMEZONE must be an IANA time zone/);
      process.env.BUSINESS_TIMEZONE = zone;
      expect(() => businessToday()).toThrow(/BUSINESS_TIMEZONE/);
    },
  );

  it('accepts IANA names', () => {
    for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati', ' Europe/Berlin ']) {
      expect(assertBusinessTimezone(zone)).toBe(zone.trim());
    }
  });
});

describe('calendar arithmetic', () => {
  const cases: [string, number, string][] = [
    ['2026-01-31', 1, '2026-02-01'],
    ['2025-12-31', 1, '2026-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2025-02-28', 1, '2025-03-01'],
    ['2024-02-29', 365, '2025-02-28'],
    ['2026-10-15', 30, '2026-11-14'],
    ['2026-12-15', 30, '2027-01-14'],
    ['2026-03-07', 1, '2026-03-08'],
    ['2026-03-08', 1, '2026-03-09'],
    ['2026-02-20', 30, '2026-03-22'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-11-01', 1, '2026-11-02'],
    ['2026-10-20', 30, '2026-11-19'],
    ['2026-05-05', 0, '2026-05-05'],
  ];

  it.each(cases)('addCalendarDays(%s, %d) = %s', (date, n, expected) => {
    expect(addCalendarDays(date, n)).toBe(expected);
  });

  it.each(['America/New_York', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])(
    'gives the same results with the process in %s (DST dates included)',
    (tz) => {
      const results = inProcessTz(tz, {}, `${JSON.stringify(cases)}.map(([d, n]) => c.addCalendarDays(d, n))`);
      expect(results).toEqual(cases.map(([, , expected]) => expected));
    },
  );

  it('addCalendarMonths rolls over like Date#setMonth', () => {
    expect(addCalendarMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addCalendarMonths('2026-11-30', 3)).toBe('2027-03-02');
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-03-03');
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-03-02');
    expect(addCalendarMonths('2024-02-29', 12)).toBe('2025-03-01');
    expect(addCalendarMonths('2026-03-08', 12)).toBe('2027-03-08');
  });
});
