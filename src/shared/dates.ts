/**
 * Date calculations and relative day offsets for Smart Duplicate and Fast Scheduler (PRD §22, §25).
 */

/** Add signed days to a YYYY-MM-DD date string safely. */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;

  // Use UTC to avoid daylight saving time hour drift
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Compute the integer day offset between two YYYY-MM-DD dates (target - source). */
export function computeDayOffset(sourceDate: string, targetDate: string): number {
  const [y1, m1, d1] = sourceDate.split("-").map(Number);
  const [y2, m2, d2] = targetDate.split("-").map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;

  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtc(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Add signed months, clamping the day to the target month's length (Jan 31 + 1mo → Feb 28). */
export function addMonths(dateStr: string, months: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;

  const total = year * 12 + (month - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12; // 0-based target month
  const daysInMonth = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return formatUtc(ny, nm + 1, Math.min(day, daysInMonth));
}

/** Add signed years (Feb 29 → Feb 28 on non-leap years). */
export function addYears(dateStr: string, years: number): string {
  return addMonths(dateStr, years * 12);
}

/** ISO-8601 week number (the W## column in Timestripe's calendar). */
export function isoWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return 0;
  const utc = Date.UTC(y, m - 1, d);
  const date = new Date(utc);
  // Thursday of this week decides the ISO year
  const dayOfWeek = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayOfWeek + 3); // move to Thursday
  const jan4 = Date.UTC(date.getUTCFullYear(), 0, 4);
  const week1Thu = new Date(jan4);
  const w1Day = (week1Thu.getUTCDay() + 6) % 7;
  week1Thu.setUTCDate(week1Thu.getUTCDate() - w1Day + 3);
  return 1 + Math.round((date.getTime() - week1Thu.getTime()) / (1000 * 60 * 60 * 24 * 7));
}

/** Monday of the week containing dateStr ("this week" quick action). */
export function weekStart(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon=0
  return addDays(dateStr, -dow);
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human-friendly short date: "Oct 5" or "Oct 5, 2027" when the year differs from today's. */
export function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const label = `${MONTHS_SHORT[m - 1]} ${d}`;
  const thisYear = new Date().getFullYear();
  return y === thisYear ? label : `${label}, ${y}`;
}
