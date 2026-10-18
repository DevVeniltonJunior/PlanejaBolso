/**
 * Financial cycles.
 *
 * A financial cycle is the period funded by one month's income. It is identified by that
 * month and bounded by the user's `defaultPaymentDay` (D). With D = 5, the October cycle
 * runs from 05/10 through 04/11.
 *
 * Two kinds of events are placed in cycles:
 * - Money spent or received on a date (Cash/Pix purchases, income): the cycle in progress
 *   on that date — `[D of month M, D of month M+1)`.
 * - Obligations due on a date (card statements, regular bills, non-card installments): the
 *   cycle responsible for paying them. An obligation due *after* D belongs to that month's
 *   cycle; one due *on or before* D is a closing payment of the previous month's cycle.
 *   With D = 5: due 17/10 → October; due 05/11 → October; due 10/11 → November.
 *
 * Credit card *billing* (which statement a purchase falls into and when it is due) is a
 * separate concept, computed only from the card's own dates in `billing.ts`. The statement
 * due date is then mapped to the cycle that pays it.
 */
import { billingMonth, statementClosingDate, statementDueDate } from './billing'
import {
  addDays,
  addMonths,
  dateInMonth,
  daysInMonth,
  monthOf,
  parseISODate,
  type SimpleDate,
  type YearMonth,
} from './dates'
import type { CreditCard, ISODate } from './types'

/** A cycle is identified by the month whose income funds it. */
export type FinancialCycle = YearMonth

/** First day of the cycle (the payment day in the cycle's month, clamped to the month length). */
export function cycleStart(cycle: FinancialCycle, paymentDay: number): SimpleDate {
  return dateInMonth(cycle, paymentDay)
}

/** Last day of the cycle (the day before the next payment day). */
export function cycleEnd(cycle: FinancialCycle, paymentDay: number): SimpleDate {
  return addDays(cycleSettlementDate(cycle, paymentDay), -1)
}

/** Next payment day: obligations due on it are the cycle's closing payments. */
export function cycleSettlementDate(cycle: FinancialCycle, paymentDay: number): SimpleDate {
  return dateInMonth(addMonths(cycle, 1), paymentDay)
}

/** Cycle in progress on a date. Used for money spent or received on that date. */
export function cycleOfDate(date: SimpleDate | ISODate, paymentDay: number): FinancialCycle {
  const d = typeof date === 'string' ? parseISODate(date) : date
  const boundary = Math.min(paymentDay, daysInMonth(d.year, d.month))
  return d.day >= boundary ? monthOf(d) : addMonths(monthOf(d), -1)
}

/**
 * Cycle responsible for an obligation due on (nominal) `day` of `month`.
 * The nominal day (before clamping to the month length) is used so a monthly obligation
 * always produces exactly one payment per cycle, even across short months.
 */
export function obligationCycle(month: YearMonth, day: number, paymentDay: number): FinancialCycle {
  return day > paymentDay ? month : addMonths(month, -1)
}

/** Inverse of `obligationCycle`: calendar month in which an obligation on `day` falls for `cycle`. */
export function obligationMonth(cycle: FinancialCycle, day: number, paymentDay: number): YearMonth {
  return day > paymentDay ? cycle : addMonths(cycle, 1)
}

export interface CardPurchasePlacement {
  /** Billing: the statement (by due month) the purchase falls into. */
  statementMonth: YearMonth
  closingDate: SimpleDate
  dueDate: SimpleDate
  /** Planning: the financial cycle that pays that statement. */
  cycle: FinancialCycle
}

/** Statement of a card purchase, then the financial cycle that pays it. */
export function placeCardPurchase(card: CreditCard, purchaseDate: ISODate, paymentDay: number): CardPurchasePlacement {
  const statementMonth = billingMonth(card, purchaseDate)
  return placeCardStatement(card, statementMonth, paymentDay)
}

export function placeCardStatement(card: CreditCard, statementMonth: YearMonth, paymentDay: number): CardPurchasePlacement {
  return {
    statementMonth,
    closingDate: statementClosingDate(card, statementMonth),
    dueDate: statementDueDate(card, statementMonth),
    cycle: obligationCycle(statementMonth, card.dueDay, paymentDay),
  }
}
