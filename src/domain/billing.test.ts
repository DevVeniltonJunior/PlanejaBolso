import { describe, expect, it } from 'vitest'
import { billingMonth, statementClosingDate, statementDueDate } from './billing'
import { addDays, addMonths, compareDates, monthOf, monthsBetween, parseISODate, toISODate, type YearMonth } from './dates'
import type { CreditCard } from './types'

const ym = (year: number, month: number): YearMonth => ({ year, month })
const card = (dueDay: number, closingDaysBefore: number): CreditCard => ({ id: 'c', nickname: 'C', dueDay, closingDaysBefore })

describe('statement dates', () => {
  it('computes the closing date from the due date', () => {
    expect(toISODate(statementClosingDate(card(5, 7), ym(2026, 11)))).toBe('2026-10-29')
    expect(toISODate(statementClosingDate(card(25, 7), ym(2026, 10)))).toBe('2026-10-18')
  })
  it('crosses month and year boundaries', () => {
    expect(toISODate(statementClosingDate(card(5, 7), ym(2027, 1)))).toBe('2026-12-29')
    expect(toISODate(statementClosingDate(card(3, 10), ym(2027, 3)))).toBe('2027-02-21') // through a 28-day February
    expect(toISODate(statementClosingDate(card(1, 1), ym(2027, 1)))).toBe('2026-12-31')
  })
  it('clamps the due day to short months', () => {
    expect(toISODate(statementDueDate(card(31, 10), ym(2027, 2)))).toBe('2027-02-28')
    expect(toISODate(statementClosingDate(card(31, 10), ym(2027, 2)))).toBe('2027-02-18')
    expect(toISODate(statementClosingDate(card(31, 10), ym(2028, 2)))).toBe('2028-02-19') // leap year
  })
})

describe('billingMonth — closing in the month before the due date (due 5, closes 7 days before)', () => {
  const c = card(5, 7) // Nov 5 statement closes Oct 29
  it('purchase before closing → upcoming statement', () => {
    expect(billingMonth(c, '2026-10-01')).toEqual(ym(2026, 11))
    expect(billingMonth(c, '2026-10-28')).toEqual(ym(2026, 11))
  })
  it('purchase on the closing day → following statement', () => {
    expect(billingMonth(c, '2026-10-29')).toEqual(ym(2026, 12))
  })
  it('purchase after closing → following statement', () => {
    expect(billingMonth(c, '2026-10-30')).toEqual(ym(2026, 12))
    expect(billingMonth(c, '2026-10-31')).toEqual(ym(2026, 12))
  })
  it('purchase early in the month, after the current statement closed', () => {
    expect(billingMonth(c, '2026-11-02')).toEqual(ym(2026, 12))
  })
  it('year boundary', () => {
    expect(billingMonth(c, '2026-12-28')).toEqual(ym(2027, 1))
    expect(billingMonth(c, '2026-12-29')).toEqual(ym(2027, 2))
    expect(billingMonth(c, '2026-12-31')).toEqual(ym(2027, 2))
    expect(billingMonth(c, '2026-11-30')).toEqual(ym(2027, 1)) // Dec 5 statement closed Nov 28
  })
})

describe('billingMonth — same-month statements (due 25, closes on the 18th)', () => {
  const c = card(25, 7)
  it('purchase before closing → statement due in the purchase month', () => {
    expect(billingMonth(c, '2026-10-01')).toEqual(ym(2026, 10))
    expect(billingMonth(c, '2026-10-10')).toEqual(ym(2026, 10))
    expect(billingMonth(c, '2026-10-17')).toEqual(ym(2026, 10))
  })
  it('purchase on/after closing → next month statement', () => {
    expect(billingMonth(c, '2026-10-18')).toEqual(ym(2026, 11))
    expect(billingMonth(c, '2026-10-31')).toEqual(ym(2026, 11))
  })
  it('year boundary', () => {
    expect(billingMonth(c, '2026-12-17')).toEqual(ym(2026, 12))
    expect(billingMonth(c, '2026-12-18')).toEqual(ym(2027, 1))
  })
})

describe('billingMonth — other cycles', () => {
  it('closing date crossing into a short February (due 3, closes 10 days before)', () => {
    const c = card(3, 10) // Mar 3 2027 → closes Feb 21; Jan 3 2027 → closes Dec 24 2026
    expect(billingMonth(c, '2027-02-20')).toEqual(ym(2027, 3))
    expect(billingMonth(c, '2027-02-21')).toEqual(ym(2027, 4))
    expect(billingMonth(c, '2027-03-01')).toEqual(ym(2027, 4))
    expect(billingMonth(c, '2026-12-23')).toEqual(ym(2027, 1))
    expect(billingMonth(c, '2026-12-24')).toEqual(ym(2027, 2))
  })
  it('long closing offset reaching back over a month (due 15, closes 20 days before)', () => {
    const c = card(15, 20) // Mar 15 2027 → closes Feb 23
    expect(billingMonth(c, '2027-02-22')).toEqual(ym(2027, 3))
    expect(billingMonth(c, '2027-02-23')).toEqual(ym(2027, 4))
  })
  it('due day 31 in short months (closes 10 days before)', () => {
    const c = card(31, 10) // Jan 31 → closes Jan 21; Feb 28 → closes Feb 18
    expect(billingMonth(c, '2027-01-17')).toEqual(ym(2027, 1))
    expect(billingMonth(c, '2027-01-21')).toEqual(ym(2027, 2))
    expect(billingMonth(c, '2027-02-17')).toEqual(ym(2027, 2))
    expect(billingMonth(c, '2027-02-18')).toEqual(ym(2027, 3))
    expect(billingMonth(c, '2028-02-18')).toEqual(ym(2028, 2))
    expect(billingMonth(c, '2028-02-19')).toEqual(ym(2028, 3))
  })
  it('closing on the last day of the previous month (due 1, closes 1 day before)', () => {
    const c = card(1, 1)
    expect(billingMonth(c, '2026-12-30')).toEqual(ym(2027, 1))
    expect(billingMonth(c, '2026-12-31')).toEqual(ym(2027, 2))
  })
})

describe('billingMonth — invariants', () => {
  const configs = [1, 5, 10, 15, 18, 25, 28, 30, 31].flatMap((due) => [1, 7, 10, 20, 28].map((closing) => card(due, closing)))

  it('picks the first statement that closes after the purchase', () => {
    for (const c of configs) {
      let previous: YearMonth | null = null
      for (let d = 0; d < 800; d++) {
        const purchase = addDays({ year: 2026, month: 1, day: 1 }, d)
        const iso = toISODate(purchase)
        const month = billingMonth(c, iso)

        // Before this statement's closing, on/after the previous statement's closing.
        expect(compareDates(purchase, statementClosingDate(c, month))).toBeLessThan(0)
        expect(compareDates(purchase, statementClosingDate(c, addMonths(month, -1)))).toBeGreaterThanOrEqual(0)
        // Due after the purchase; between the purchase month and two months later.
        expect(compareDates(statementDueDate(c, month), parseISODate(iso))).toBeGreaterThan(0)
        expect(monthsBetween(monthOf(purchase), month)).toBeGreaterThanOrEqual(0)
        expect(monthsBetween(monthOf(purchase), month)).toBeLessThanOrEqual(2)
        // A later purchase never lands on an earlier statement.
        if (previous) expect(monthsBetween(previous, month)).toBeGreaterThanOrEqual(0)
        previous = month
      }
    }
  })
})
