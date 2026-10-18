import { addDays, addMonths, compareDates, dateInMonth, monthOf, parseISODate, type SimpleDate, type YearMonth } from './dates'
import type { CreditCard, ISODate } from './types'

type CardBilling = Pick<CreditCard, 'dueDay' | 'closingDaysBefore'>

/** Due date of the statement that is due in `statementMonth`. */
export function statementDueDate(card: CardBilling, statementMonth: YearMonth): SimpleDate {
  return dateInMonth(statementMonth, card.dueDay)
}

/** Closing date of the statement that is due in `statementMonth`. */
export function statementClosingDate(card: CardBilling, statementMonth: YearMonth): SimpleDate {
  return addDays(statementDueDate(card, statementMonth), -card.closingDaysBefore)
}

/**
 * Month of the statement (identified by its due month) that a purchase falls into.
 *
 * A purchase made before the closing date belongs to that statement; a purchase made
 * on or after the closing date goes to the following one (the usual Brazilian rule —
 * the closing day is the "best day to buy").
 */
export function billingMonth(card: CardBilling, purchaseDate: ISODate): YearMonth {
  const purchase = parseISODate(purchaseDate)
  // No statement due before the purchase month can close after the purchase,
  // so the search starts at the purchase month and walks forward.
  let candidate = monthOf(purchase)
  for (let i = 0; i < 24; i++) {
    if (compareDates(purchase, statementClosingDate(card, candidate)) < 0) return candidate
    candidate = addMonths(candidate, 1)
  }
  throw new Error('Could not determine billing month')
}
