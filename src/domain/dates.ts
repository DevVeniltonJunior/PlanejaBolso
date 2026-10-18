import type { ISODate } from './types'

export interface YearMonth {
  year: number
  /** 1–12 */
  month: number
}

export interface SimpleDate extends YearMonth {
  day: number
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function parseISODate(iso: ISODate): SimpleDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) throw new Error(`Invalid date: ${iso}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

export function toISODate(d: SimpleDate): ISODate {
  return `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Date in the given month at `day`, clamped to the month length (e.g. day 31 in Feb → 28/29). */
export function dateInMonth(ym: YearMonth, day: number): SimpleDate {
  return { year: ym.year, month: ym.month, day: Math.min(Math.max(day, 1), daysInMonth(ym.year, ym.month)) }
}

export function monthIndex(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1)
}

export function addMonths(ym: YearMonth, n: number): YearMonth {
  const idx = monthIndex(ym) + n
  return { year: Math.floor(idx / 12), month: (((idx % 12) + 12) % 12) + 1 }
}

/** Number of months from `a` to `b` (positive when `b` is later). */
export function monthsBetween(a: YearMonth, b: YearMonth): number {
  return monthIndex(b) - monthIndex(a)
}

export function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month
}

export function monthOf(d: SimpleDate | ISODate): YearMonth {
  const date = typeof d === 'string' ? parseISODate(d) : d
  return { year: date.year, month: date.month }
}

export function addDays(d: SimpleDate, n: number): SimpleDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

export function compareDates(a: SimpleDate, b: SimpleDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

/** `YYYY-MM` key, also the value format of `<input type="month">`. */
export function monthKey(ym: YearMonth): string {
  return `${pad(ym.year, 4)}-${pad(ym.month)}`
}

export function parseMonthKey(key: string): YearMonth {
  const [y, m] = key.split('-').map(Number)
  return { year: y, month: m }
}

/** Today in the user's local timezone. */
export function today(now: Date = new Date()): SimpleDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(today(now))
}

export function currentMonth(now: Date = new Date()): YearMonth {
  return monthOf(today(now))
}
