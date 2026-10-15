/**
 * Calendar-date utilities.
 *
 * Every date in this app is a `YYYY-MM-DD` string. All arithmetic goes through
 * an integer "epoch day" built with `Date.UTC`, so results never shift by a day
 * because of the browser's timezone or daylight-saving changes. No function in
 * this file ever parses a date string with `new Date(string)`.
 */

import type { ISODate } from '@/types';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

/** Number of days in a given month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True when `value` is a well-formed, really-existing calendar date. */
export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  // Guard against absurd years that are almost certainly typos.
  return year >= 1900 && year <= 2200;
}

/** Split a validated date into its parts. Throws on malformed input. */
export function dateParts(iso: ISODate): DateParts {
  const match = ISO_DATE_RE.exec(iso);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${iso}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Build a date string from parts, zero-padding as needed. */
export function fromParts({ year, month, day }: DateParts): ISODate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(
    day,
  ).padStart(2, '0')}`;
}

/** Whole days between 1970-01-01 and `iso`. The canonical numeric form of a date. */
export function toEpochDay(iso: ISODate): number {
  const { year, month, day } = dateParts(iso);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Inverse of {@link toEpochDay}. */
export function fromEpochDay(epochDay: number): ISODate {
  const d = new Date(epochDay * MS_PER_DAY);
  return fromParts({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  });
}

/**
 * Signed day count from `from` to `to`.
 * `diffDays('2026-09-04', '2026-10-17')` → `43`.
 */
export function diffDays(from: ISODate, to: ISODate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Shift a date by whole days. Negative `days` moves backwards. */
export function addDays(iso: ISODate, days: number): ISODate {
  return fromEpochDay(toEpochDay(iso) + Math.trunc(days));
}

/** `-1 | 0 | 1` comparison usable directly as an `Array.sort` comparator. */
export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Today's date in the *user's own* calendar, as `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): ISODate {
  return fromParts({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  });
}

/* ----------------------------------------------------- month / year keys -- */

/** `"2026-09"` — the sortable grouping key for a month. */
export type MonthKey = string;

export function monthKeyOf(iso: ISODate): MonthKey {
  return iso.slice(0, 7);
}

export function yearOf(iso: ISODate): number {
  return dateParts(iso).year;
}

/** 1-12. */
export function monthOf(iso: ISODate): number {
  return dateParts(iso).month;
}

export function monthKeyParts(key: MonthKey): { year: number; month: number } {
  const [y, m] = key.split('-');
  return { year: Number(y), month: Number(m) };
}

/** First day of a month key. */
export function monthStart(key: MonthKey): ISODate {
  const { year, month } = monthKeyParts(key);
  return fromParts({ year, month, day: 1 });
}

/** Last day of a month key. */
export function monthEnd(key: MonthKey): ISODate {
  const { year, month } = monthKeyParts(key);
  return fromParts({ year, month, day: daysInMonth(year, month) });
}

/** Every month key from `from` to `to` inclusive, ascending and gap-free. */
export function monthKeyRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const start = monthKeyParts(from);
  const end = monthKeyParts(to);
  const out: MonthKey[] = [];
  let { year, month } = start;
  // Hard stop keeps a malformed range from looping forever.
  for (let guard = 0; guard < 2400; guard += 1) {
    if (year > end.year || (year === end.year && month > end.month)) break;
    out.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------ formatting -- */

/** `"2026-09-04"` → `"4 September 2026"`. */
export function formatLongDate(iso: ISODate | null | undefined): string {
  if (!iso || !isValidISODate(iso)) return '—';
  const { year, month, day } = dateParts(iso);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** `"2026-09-04"` → `"4 Sep 2026"`. */
export function formatShortDate(iso: ISODate | null | undefined): string {
  if (!iso || !isValidISODate(iso)) return '—';
  const { year, month, day } = dateParts(iso);
  return `${day} ${MONTH_NAMES_SHORT[month - 1]} ${year}`;
}

/** `"2026-09"` → `"Sep 2026"`. */
export function formatMonthKey(key: MonthKey): string {
  const { year, month } = monthKeyParts(key);
  if (!month || month < 1 || month > 12) return key;
  return `${MONTH_NAMES_SHORT[month - 1]} ${year}`;
}

/** 1-12 → `"September"`. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

/** 1-12 → `"Sep"`. */
export function monthNameShort(month: number): string {
  return MONTH_NAMES_SHORT[month - 1] ?? String(month);
}

/** `"43 days"`, `"1 day"`, `"—"`. */
export function formatDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return '—';
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${Math.abs(rounded) === 1 ? 'day' : 'days'}`;
}

/** A plain-language gap, e.g. `"in 11 days"`, `"today"`, `"4 days ago"`. */
export function formatRelativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/* ----------------------------------------------------------- date spans -- */

/**
 * How many days of the inclusive span `[start, end]` fall inside `monthKey`.
 *
 * Used by the seasonal view to spread one cylinder's consumption across the
 * months it actually burned in, rather than dumping it all on one month.
 */
export function daysOfSpanInMonth(start: ISODate, end: ISODate, monthKey: MonthKey): number {
  const spanStart = toEpochDay(start);
  const spanEnd = toEpochDay(end);
  if (spanEnd < spanStart) return 0;
  const mStart = toEpochDay(monthStart(monthKey));
  const mEnd = toEpochDay(monthEnd(monthKey));
  const lo = Math.max(spanStart, mStart);
  const hi = Math.min(spanEnd, mEnd);
  return hi < lo ? 0 : hi - lo + 1;
}

/** Every month key touched by the inclusive span `[start, end]`. */
export function monthKeysInSpan(start: ISODate, end: ISODate): MonthKey[] {
  if (toEpochDay(end) < toEpochDay(start)) return [];
  return monthKeyRange(monthKeyOf(start), monthKeyOf(end));
}
