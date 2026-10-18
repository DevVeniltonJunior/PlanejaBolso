/**
 * Projection engine — the single source of truth for monthly figures.
 * Dashboard, future months, income commitment and the purchase simulator all use it.
 */
import { billingMonth } from './billing'
import {
  addMonths,
  compareDates,
  dateInMonth,
  monthOf,
  monthsBetween,
  parseISODate,
  sameMonth,
  type YearMonth,
} from './dates'
import { roundMoney, sumMoney } from './money'
import { salaryForMonth, type SalarySource } from './salary'
import type {
  CreditCard,
  Expense,
  ExpenseType,
  FinancialData,
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
    items: ExpenseCharge[]
  }
  balance: number
  /** Expenses / income × 100. `null` when no income is expected. */
  commitment: number | null
}

type CardLookup = Map<string, CreditCard>

const cardLookup = (cards: CreditCard[]): CardLookup => new Map(cards.map((c) => [c.id, c]))

// ---------------------------------------------------------------- recurrence

interface RecurringRule {
  recurrence: Recurrence
  chargeDay: number
  chargeMonth: number | null
  startDate: string
}

/** Whether a monthly/annual charge happens in `ym`, on or after its start date. */
export function recurringAppliesTo(rule: RecurringRule, ym: YearMonth): boolean {
  if (rule.recurrence === 'ANNUAL' && rule.chargeMonth !== ym.month) return false
  const occurrence = dateInMonth(ym, rule.chargeDay)
  return compareDates(occurrence, parseISODate(rule.startDate)) >= 0
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

/** Month in which a single-payment purchase is paid (statement month for credit cards). */
export function paymentMonth(
  purchase: Pick<OccasionalExpense, 'purchaseDate' | 'paymentMethod' | 'cardId'>,
  cards: CardLookup,
): YearMonth {
  const card = purchase.paymentMethod === 'CREDIT_CARD' && purchase.cardId ? cards.get(purchase.cardId) : undefined
  return card ? billingMonth(card, purchase.purchaseDate) : monthOf(purchase.purchaseDate)
}

/** Month of the first installment payment. */
export function firstInstallmentMonth(
  e: Pick<InstallmentExpense, 'purchaseDate' | 'paymentMethod' | 'cardId' | 'firstPaymentDate'>,
  cards: CardLookup,
): YearMonth {
  const card = e.paymentMethod === 'CREDIT_CARD' && e.cardId ? cards.get(e.cardId) : undefined
  if (card) return billingMonth(card, e.purchaseDate)
  return monthOf(e.firstPaymentDate ?? e.purchaseDate)
}

/** Charges an expense produces in a given month (zero or one). */
export function chargesInMonth(expense: Expense, ym: YearMonth, cards: CardLookup): ExpenseCharge[] {
  const base = { expenseId: expense.id, name: expense.name, type: expense.type }
  switch (expense.type) {
    case 'FIXED':
    case 'SUBSCRIPTION':
      return recurringAppliesTo(expense, ym) ? [{ ...base, amount: expense.amount }] : []
    case 'OCCASIONAL':
      return sameMonth(paymentMonth(expense, cards), ym) ? [{ ...base, amount: expense.amount }] : []
    case 'INSTALLMENT': {
      const k = monthsBetween(firstInstallmentMonth(expense, cards), ym)
      if (k < 0 || k >= expense.installmentsCount) return []
      return [{ ...base, amount: expense.installmentAmount, installmentLabel: `${k + 1}/${expense.installmentsCount}` }]
    }
  }
}

/** Last month affected by an expense; `null` for open-ended recurring expenses. */
export function lastChargeMonth(expense: NewExpense, cards: CreditCard[]): YearMonth | null {
  const lookup = cardLookup(cards)
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

function project(data: FinancialData, ym: YearMonth, cards: CardLookup): MonthProjection {
  const salary = salaryForMonth(data, ym)
  const incomeItems: IncomeItem[] = data.incomeSources
    .filter((s) => incomeAppliesTo(s, ym))
    .map((s) => ({ sourceId: s.id, name: s.name, amount: s.amount }))
  const otherIncome = sumMoney(incomeItems.map((i) => i.amount))
  const incomeTotal = roundMoney(salary.amount + otherIncome)

  const items = data.expenses.flatMap((e) => chargesInMonth(e, ym, cards))
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
  return project(data, ym, cardLookup(data.cards))
}

/** Projects `count` consecutive months starting at `start`. Not limited to any horizon. */
export function projectMonths(data: FinancialData, start: YearMonth, count: number): MonthProjection[] {
  const cards = cardLookup(data.cards)
  return Array.from({ length: count }, (_, i) => project(data, addMonths(start, i), cards))
}
