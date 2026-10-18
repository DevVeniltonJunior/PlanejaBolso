import { describe, expect, it } from 'vitest'
import {
  cycleEnd,
  cycleOfDate,
  cycleSettlementDate,
  cycleStart,
  obligationCycle,
  obligationMonth,
  placeCardPurchase,
} from './cycle'
import { addDays, addMonths, compareDates, dateInMonth, monthsBetween, toISODate, type YearMonth } from './dates'
import type { CreditCard } from './types'

const ym = (year: number, month: number): YearMonth => ({ year, month })
const card = (dueDay: number, closingDaysBefore: number): CreditCard => ({ id: 'c', nickname: 'C', dueDay, closingDaysBefore })
const iso = toISODate

describe('cycle period', () => {
  it('runs from the payment day to the day before the next one (day 5: 05/10 → 04/11)', () => {
    expect(iso(cycleStart(ym(2026, 10), 5))).toBe('2026-10-05')
    expect(iso(cycleEnd(ym(2026, 10), 5))).toBe('2026-11-04')
    expect(iso(cycleSettlementDate(ym(2026, 10), 5))).toBe('2026-11-05')
  })
  it('crosses the year boundary', () => {
    expect(iso(cycleStart(ym(2026, 12), 5))).toBe('2026-12-05')
    expect(iso(cycleEnd(ym(2026, 12), 5))).toBe('2027-01-04')
  })
  it('clamps the payment day in short months and leap years', () => {
    expect([cycleStart, cycleEnd, cycleSettlementDate].map((f) => iso(f(ym(2027, 1), 31)))).toEqual(['2027-01-31', '2027-02-27', '2027-02-28'])
    expect([cycleStart, cycleEnd, cycleSettlementDate].map((f) => iso(f(ym(2028, 1), 31)))).toEqual(['2028-01-31', '2028-02-28', '2028-02-29'])
    expect([cycleStart, cycleEnd].map((f) => iso(f(ym(2027, 2), 31)))).toEqual(['2027-02-28', '2027-03-30'])
    expect([cycleStart, cycleEnd].map((f) => iso(f(ym(2027, 2), 30)))).toEqual(['2027-02-28', '2027-03-29'])
  })
})

describe('cycleOfDate (money spent or received on a date)', () => {
  it('uses the cycle in progress', () => {
    expect(cycleOfDate('2026-10-04', 5)).toEqual(ym(2026, 9))
    expect(cycleOfDate('2026-10-05', 5)).toEqual(ym(2026, 10))
    expect(cycleOfDate('2026-11-04', 5)).toEqual(ym(2026, 10))
    expect(cycleOfDate('2026-11-05', 5)).toEqual(ym(2026, 11))
    expect(cycleOfDate('2027-01-03', 5)).toEqual(ym(2026, 12))
  })
  it('handles day 1 and clamped payment days', () => {
    expect(cycleOfDate('2026-10-01', 1)).toEqual(ym(2026, 10))
    expect(cycleOfDate('2026-09-30', 1)).toEqual(ym(2026, 9))
    expect(cycleOfDate('2027-02-27', 31)).toEqual(ym(2027, 1))
    expect(cycleOfDate('2027-02-28', 31)).toEqual(ym(2027, 2))
    expect(cycleOfDate('2027-03-30', 31)).toEqual(ym(2027, 2))
    expect(cycleOfDate('2027-03-31', 31)).toEqual(ym(2027, 3))
    expect(cycleOfDate('2028-02-29', 31)).toEqual(ym(2028, 2))
  })
})

describe('obligationCycle (bills due on a date)', () => {
  it('due after the payment day → that month; on/before → closes the previous cycle', () => {
    expect(obligationCycle(ym(2026, 10), 17, 5)).toEqual(ym(2026, 10))
    expect(obligationCycle(ym(2026, 11), 3, 5)).toEqual(ym(2026, 10))
    expect(obligationCycle(ym(2026, 11), 5, 5)).toEqual(ym(2026, 10))
    expect(obligationCycle(ym(2026, 11), 10, 5)).toEqual(ym(2026, 11))
    expect(obligationCycle(ym(2027, 1), 5, 5)).toEqual(ym(2026, 12))
  })

  it('places every monthly obligation exactly once per cycle, within the cycle period', () => {
    for (let paymentDay = 1; paymentDay <= 31; paymentDay++) {
      for (let day = 1; day <= 31; day++) {
        let previous: YearMonth | null = null
        for (let i = 0; i < 30; i++) {
          const month = addMonths(ym(2026, 1), i) // covers 2027 and the 2028 leap year
          const cycle = obligationCycle(month, day, paymentDay)
          const date = dateInMonth(month, day)
          expect(obligationMonth(cycle, day, paymentDay)).toEqual(month)
          expect(compareDates(date, cycleStart(cycle, paymentDay))).toBeGreaterThanOrEqual(0)
          expect(compareDates(date, cycleSettlementDate(cycle, paymentDay))).toBeLessThanOrEqual(0)
          if (previous) expect(monthsBetween(previous, cycle)).toBe(1)
          previous = cycle
        }
      }
    }
  })

  it('cycleOfDate partitions time into consecutive cycles', () => {
    for (const paymentDay of [1, 5, 15, 28, 29, 30, 31]) {
      for (let d = 0; d < 800; d++) {
        const date = addDays({ year: 2026, month: 1, day: 1 }, d)
        const cycle = cycleOfDate(date, paymentDay)
        expect(compareDates(date, cycleStart(cycle, paymentDay))).toBeGreaterThanOrEqual(0)
        expect(compareDates(date, cycleEnd(cycle, paymentDay))).toBeLessThanOrEqual(0)
      }
    }
  })
})

describe('placeCardPurchase (statement first, then the cycle that pays it)', () => {
  const place = (c: CreditCard, date: string, paymentDay: number) => {
    const p = placeCardPurchase(c, date, paymentDay)
    return { statement: p.statementMonth, due: iso(p.dueDate), cycle: p.cycle }
  }

  describe('payment day 5, card due on the 5th closing 7 days before', () => {
    const c = card(5, 7) // Nov 5 statement closes Oct 29
    it('purchase on Oct 20 → statement due Nov 5 → October cycle', () => {
      expect(place(c, '2026-10-20', 5)).toEqual({ statement: ym(2026, 11), due: '2026-11-05', cycle: ym(2026, 10) })
      expect(iso(placeCardPurchase(c, '2026-10-20', 5).closingDate)).toBe('2026-10-29')
    })
    it('purchase on the closing day → statement due Dec 5 → November cycle', () => {
      expect(place(c, '2026-10-29', 5)).toEqual({ statement: ym(2026, 12), due: '2026-12-05', cycle: ym(2026, 11) })
    })
    it('purchase on Oct 30 → statement due Dec 5 → November cycle', () => {
      expect(place(c, '2026-10-30', 5)).toEqual({ statement: ym(2026, 12), due: '2026-12-05', cycle: ym(2026, 11) })
    })
    it('year boundary', () => {
      expect(place(c, '2026-12-28', 5)).toEqual({ statement: ym(2027, 1), due: '2027-01-05', cycle: ym(2026, 12) })
      expect(place(c, '2026-12-29', 5)).toEqual({ statement: ym(2027, 2), due: '2027-02-05', cycle: ym(2027, 1) })
    })
  })

  it('cards with other due days (payment day 5)', () => {
    // Due 10, closes the 3rd: due after the payment day → the statement month's cycle.
    expect(place(card(10, 7), '2026-10-02', 5)).toEqual({ statement: ym(2026, 10), due: '2026-10-10', cycle: ym(2026, 10) })
    expect(place(card(10, 7), '2026-10-20', 5)).toEqual({ statement: ym(2026, 11), due: '2026-11-10', cycle: ym(2026, 11) })
    // Due 25, closes the 18th: same-month statement.
    expect(place(card(25, 7), '2026-10-10', 5)).toEqual({ statement: ym(2026, 10), due: '2026-10-25', cycle: ym(2026, 10) })
    expect(place(card(25, 7), '2026-10-18', 5)).toEqual({ statement: ym(2026, 11), due: '2026-11-25', cycle: ym(2026, 11) })
    expect(place(card(25, 7), '2026-12-18', 5)).toEqual({ statement: ym(2027, 1), due: '2027-01-25', cycle: ym(2027, 1) })
    // Due 1, closes the day before.
    expect(place(card(1, 1), '2026-10-30', 5)).toEqual({ statement: ym(2026, 11), due: '2026-11-01', cycle: ym(2026, 10) })
    expect(place(card(1, 1), '2026-10-31', 5)).toEqual({ statement: ym(2026, 12), due: '2026-12-01', cycle: ym(2026, 11) })
  })

  it('the payment day changes the cycle, never the statement or its due date', () => {
    const c = card(5, 7)
    expect(place(c, '2026-10-20', 3)).toEqual({ statement: ym(2026, 11), due: '2026-11-05', cycle: ym(2026, 11) })
    expect(place(c, '2026-10-20', 10)).toEqual({ statement: ym(2026, 11), due: '2026-11-05', cycle: ym(2026, 10) })
    expect(place(c, '2026-10-20', 28)).toEqual({ statement: ym(2026, 11), due: '2026-11-05', cycle: ym(2026, 10) })
    expect(place(card(15, 7), '2026-10-20', 10)).toEqual({ statement: ym(2026, 11), due: '2026-11-15', cycle: ym(2026, 11) })
  })

  it('is not a "purchase month + 1" rule', () => {
    // Same purchase month, different cycles: +0, +1 and +1 months from the purchase.
    expect(place(card(5, 7), '2026-10-20', 5).cycle).toEqual(ym(2026, 10))
    expect(place(card(5, 7), '2026-10-30', 5).cycle).toEqual(ym(2026, 11))
    expect(place(card(25, 7), '2026-10-10', 5).cycle).toEqual(ym(2026, 10))
    expect(place(card(5, 7), '2026-10-20', 3).cycle).toEqual(ym(2026, 11))
  })

  it('short months and leap years', () => {
    // Due 31 closing 10: Feb 2027 statement due Feb 28.
    expect(place(card(31, 10), '2027-02-17', 5)).toEqual({ statement: ym(2027, 2), due: '2027-02-28', cycle: ym(2027, 2) })
    // Payment day 31 and card due 31: the Feb 28 statement closes the January cycle.
    expect(place(card(31, 10), '2027-02-17', 31)).toEqual({ statement: ym(2027, 2), due: '2027-02-28', cycle: ym(2027, 1) })
    expect(place(card(31, 10), '2028-02-18', 31)).toEqual({ statement: ym(2028, 2), due: '2028-02-29', cycle: ym(2028, 1) })
    expect(iso(cycleSettlementDate(ym(2028, 1), 31))).toBe('2028-02-29')
  })

  it('the statement due date always lies within the paying cycle (start → settlement day)', () => {
    for (const paymentDay of [1, 5, 10, 25, 31]) {
      for (const c of [card(1, 1), card(5, 7), card(10, 7), card(25, 7), card(31, 10)]) {
        for (let d = 0; d < 500; d++) {
          const p = placeCardPurchase(c, iso(addDays({ year: 2026, month: 6, day: 1 }, d)), paymentDay)
          expect(compareDates(p.dueDate, cycleStart(p.cycle, paymentDay))).toBeGreaterThanOrEqual(0)
          expect(compareDates(p.dueDate, cycleSettlementDate(p.cycle, paymentDay))).toBeLessThanOrEqual(0)
        }
      }
    }
  })
})
