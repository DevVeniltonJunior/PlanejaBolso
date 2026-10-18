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
 * Month of the statement (identified by its due month) that a purchase falls into,
 * following the card's real billing cycle — only purchase date, closing date and due date matter.
 *
 * The purchase belongs to the first statement whose closing date is after it:
 * - before the upcoming statement's closing date → that statement, even if it is due
 *   in the purchase month itself (e.g. due on the 25th, closing on the 18th);
 * - on or after the closing date → the following statement.
 * The closing day itself is the "best day to buy": it already goes to the following statement.
 */
export function billingMonth(card: CardBilling, purchaseDate: ISODate): YearMonth {
  const purchase = parseISODate(purchaseDate)
  // A statement due before the purchase month always closed before the purchase,
  // so the search starts at the purchase month and walks forward.
  let candidate = monthOf(purchase)
  for (let i = 0; i < 24; i++) {
    if (compareDates(purchase, statementClosingDate(card, candidate)) < 0) return candidate
    candidate = addMonths(candidate, 1)
  }
  throw new Error('Could not determine billing month')
}
