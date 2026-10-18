/**
 * Projection engine — the single source of truth for monthly figures.
 * Dashboard, future months, income commitment and the purchase simulator all use it.
 *
 * When an expense is paid:
 * - Fixed expenses / subscriptions: on the expense's `paymentDayOverride`, or the user's
 *   `defaultPaymentDay` when there is no override.
 * - Credit card purchases (single or installments): on the card's own statement due date,
 *   following the card's real billing cycle. `defaultPaymentDay` never applies to cards.
 * - Cash / Pix purchases: on the purchase date.
 * - Non-card installments: monthly from the first payment date.
 */
import { billingMonth, statementDueDate } from './billing'
import {
  addMonths,
  compareDates,
  dateInMonth,
  monthOf,
  monthsBetween,
  parseISODate,
  sameMonth,
  toISODate,
  type YearMonth,
} from './dates'
import { roundMoney, sumMoney } from './money'
import { salaryForMonth, type SalarySource } from './salary'
import type {
  CreditCard,
  Expense,
  ExpenseType,
  FinancialData,
  ISODate,
  IncomeSource,
  InstallmentExpense,
  NewExpense,
  OccasionalExpense,
  Recurrence,
} from './types'

export interface ExpenseCharge {
  expenseId: string
  name: string
  type: ExpenseType
  amount: number
  /** Expected payment date in the month (card due date for card purchases). */
  date: ISODate
  /** Card nickname, for card purchases. */
  cardName?: string
  /** e.g. "3/10" for installments. */
  installmentLabel?: string
}

export interface IncomeItem {
  sourceId: string
  name: string
  amount: number
}

export interface MonthProjection {
  month: YearMonth
  income: {
    salary: number
    salarySource: SalarySource
    other: number
    total: number
    items: IncomeItem[]
  }
  expenses: {
    fixed: number
    installments: number
    subscriptions: number
    occasional: number
    total: number
    /** Sorted by expected payment date. */
    items: ExpenseCharge[]
  }
  balance: number
  /** Expenses / income × 100. `null` when no income is expected. */
  commitment: number | null
}

type CardLookup = Map<string, CreditCard>

/** Inputs the placement rules need besides the expense itself. */
export interface ProjectionContext {
  cards: CardLookup
  defaultPaymentDay: number
}

export function projectionContext(data: Pick<FinancialData, 'cards' | 'defaultPaymentDay'>): ProjectionContext {
  return { cards: new Map(data.cards.map((c) => [c.id, c])), defaultPaymentDay: data.defaultPaymentDay }
}

// ---------------------------------------------------------------- recurrence

interface RecurringRule {
  recurrence: Recurrence
  paymentDayOverride: number | null
  chargeMonth: number | null
  startDate: string
}

/** Day of month a regular (fixed/subscription) expense is paid. */
export function effectivePaymentDay(rule: Pick<RecurringRule, 'paymentDayOverride'>, defaultPaymentDay: number): number {
  return rule.paymentDayOverride ?? defaultPaymentDay
}

/** Payment date of a monthly/annual expense in `ym`, or `null` if it is not charged that month. */
export function recurringPaymentDate(rule: RecurringRule, ym: YearMonth, defaultPaymentDay: number): ISODate | null {
  if (rule.recurrence === 'ANNUAL' && rule.chargeMonth !== ym.month) return null
  const date = dateInMonth(ym, effectivePaymentDay(rule, defaultPaymentDay))
  // Only payments on or after the start date count.
  return compareDates(date, parseISODate(rule.startDate)) >= 0 ? toISODate(date) : null
}

export function incomeAppliesTo(source: IncomeSource, ym: YearMonth): boolean {
  const first = monthOf(source.expectedDate)
  const diff = monthsBetween(first, ym)
  switch (source.recurrence) {
    case 'MONTHLY':
      return diff >= 0
    case 'ANNUAL':
      return diff >= 0 && diff % 12 === 0
    case 'OCCASIONAL':
      return diff === 0
  }
}

// ---------------------------------------------------------------- expense placement

const cardOf = (method: string, cardId: string | null, cards: CardLookup) =>
  method === 'CREDIT_CARD' && cardId ? cards.get(cardId) : undefined

/**
 * Month in which a single-payment purchase is paid: the card's statement month for credit
 * cards (which may be the purchase month), the purchase month for Cash/Pix.
 * An unknown card falls back to the purchase month.
 */
export function paymentMonth(
  purchase: Pick<OccasionalExpense, 'purchaseDate' | 'paymentMethod' | 'cardId'>,
  cards: CardLookup,
): YearMonth {
  const card = cardOf(purchase.paymentMethod, purchase.cardId, cards)
  return card ? billingMonth(card, purchase.purchaseDate) : monthOf(purchase.purchaseDate)
}

/** Month of the first installment: the card's statement month, or the first payment date's month. */
export function firstInstallmentMonth(
  e: Pick<InstallmentExpense, 'purchaseDate' | 'paymentMethod' | 'cardId' | 'firstPaymentDate'>,
  cards: CardLookup,
): YearMonth {
  const card = cardOf(e.paymentMethod, e.cardId, cards)
  if (card) return billingMonth(card, e.purchaseDate)
  return monthOf(e.firstPaymentDate ?? e.purchaseDate)
}

/** Charges an expense produces in a given month (zero or one). */
export function chargesInMonth(expense: Expense, ym: YearMonth, ctx: ProjectionContext): ExpenseCharge[] {
  const base = { expenseId: expense.id, name: expense.name, type: expense.type }
  switch (expense.type) {
    case 'FIXED':
    case 'SUBSCRIPTION': {
      const date = recurringPaymentDate(expense, ym, ctx.defaultPaymentDay)
      return date ? [{ ...base, amount: expense.amount, date }] : []
    }
    case 'OCCASIONAL': {
      if (!sameMonth(paymentMonth(expense, ctx.cards), ym)) return []
      const card = cardOf(expense.paymentMethod, expense.cardId, ctx.cards)
      const date = card ? toISODate(statementDueDate(card, ym)) : expense.purchaseDate
      return [{ ...base, amount: expense.amount, date, cardName: card?.nickname }]
    }
    case 'INSTALLMENT': {
      const k = monthsBetween(firstInstallmentMonth(expense, ctx.cards), ym)
      if (k < 0 || k >= expense.installmentsCount) return []
      const card = cardOf(expense.paymentMethod, expense.cardId, ctx.cards)
      const day = parseISODate(expense.firstPaymentDate ?? expense.purchaseDate).day
      const date = toISODate(card ? statementDueDate(card, ym) : dateInMonth(ym, day))
      return [
        {
          ...base,
          amount: expense.installmentAmount,
          date,
          cardName: card?.nickname,
          installmentLabel: `${k + 1}/${expense.installmentsCount}`,
        },
      ]
    }
  }
}

/** Last month affected by an expense; `null` for open-ended recurring expenses. */
export function lastChargeMonth(expense: NewExpense, cards: CreditCard[]): YearMonth | null {
  const lookup: CardLookup = new Map(cards.map((c) => [c.id, c]))
  switch (expense.type) {
    case 'FIXED':
    case 'SUBSCRIPTION':
      return null
    case 'OCCASIONAL':
      return paymentMonth(expense, lookup)
    case 'INSTALLMENT':
      return addMonths(firstInstallmentMonth(expense, lookup), expense.installmentsCount - 1)
  }
}

export function installmentTotal(e: Pick<InstallmentExpense, 'installmentAmount' | 'installmentsCount'>): number {
  return roundMoney(e.installmentAmount * e.installmentsCount)
}

// ---------------------------------------------------------------- projection

export function commitmentPercent(expenses: number, income: number): number | null {
  if (income <= 0) return null
  return (expenses / income) * 100
}

function project(data: FinancialData, ym: YearMonth, ctx: ProjectionContext): MonthProjection {
  const salary = salaryForMonth(data, ym)
  const incomeItems: IncomeItem[] = data.incomeSources
    .filter((s) => incomeAppliesTo(s, ym))
    .map((s) => ({ sourceId: s.id, name: s.name, amount: s.amount }))
  const otherIncome = sumMoney(incomeItems.map((i) => i.amount))
  const incomeTotal = roundMoney(salary.amount + otherIncome)

  const items = data.expenses
    .flatMap((e) => chargesInMonth(e, ym, ctx))
    .sort((a, b) => a.date.localeCompare(b.date))
  const totalOf = (type: ExpenseType) => sumMoney(items.filter((i) => i.type === type).map((i) => i.amount))
  const expenseTotal = sumMoney(items.map((i) => i.amount))

  return {
    month: ym,
    income: { salary: salary.amount, salarySource: salary.source, other: otherIncome, total: incomeTotal, items: incomeItems },
    expenses: {
      fixed: totalOf('FIXED'),
      installments: totalOf('INSTALLMENT'),
      subscriptions: totalOf('SUBSCRIPTION'),
      occasional: totalOf('OCCASIONAL'),
      total: expenseTotal,
      items,
    },
    balance: roundMoney(incomeTotal - expenseTotal),
    commitment: commitmentPercent(expenseTotal, incomeTotal),
  }
}

export function projectMonth(data: FinancialData, ym: YearMonth): MonthProjection {
  return project(data, ym, projectionContext(data))
}

/** Projects `count` consecutive months starting at `start`. Not limited to any horizon. */
export function projectMonths(data: FinancialData, start: YearMonth, count: number): MonthProjection[] {
  const ctx = projectionContext(data)
  return Array.from({ length: count }, (_, i) => project(data, addMonths(start, i), ctx))
}
