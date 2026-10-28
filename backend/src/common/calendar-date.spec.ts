import { calendarDateParts, toCalendarDate } from './calendar-date';

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

  it('refuses something that is not a date', () => {
    expect(() => toCalendarDate('not a date')).toThrow(RangeError);
  });
});
