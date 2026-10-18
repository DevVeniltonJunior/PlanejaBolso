/**
 * Projection engine — the single source of truth for projected figures.
 * Dashboard, future cycles, income commitment, expense views and the purchase simulator all use it.
 *
 * Projections are made per **financial cycle** (see `cycle.ts`), not per calendar month.
 * Each item keeps its real date (purchase, payment or statement due date) and is assigned
 * to the cycle that funds it:
 * - Fixed expenses / subscriptions: paid on `paymentDayOverride` or `defaultPaymentDay`,
 *   placed by the obligation rule (due on/before the payment day → previous cycle).
 * - Credit card purchases (single or installments): statement computed from the card's own
 *   closing and due dates (`billing.ts`), then the statement due date is placed by the
 *   obligation rule. Installments fall on consecutive statements, hence consecutive cycles.
 * - Non-card installments: monthly from the first payment date, placed by the obligation rule.
 * - Cash / Pix purchases and income: the cycle in progress on their date.
 * - Salary: the cycle of its reference month.
 */
import { statementDueDate } from './billing'
import {
  cycleEnd,
  cycleOfDate,
  cycleSettlementDate,
  cycleStart,
  obligationCycle,
  obligationMonth,
  placeCardPurchase,
  type FinancialCycle,
} from './cycle'
import { addMonths, compareDates, dateInMonth, monthOf, monthsBetween, parseISODate, sameMonth, toISODate, type YearMonth } from './dates'
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
  /** Real date of the payment: payment day, purchase date or card statement due date. */
  date: ISODate
  /** Billing: statement month (by due month), for card purchases. */
  statementMonth?: YearMonth
  /** Card nickname, for card purchases. */
  cardName?: string
  /** e.g. "3/10" for installments. */
  installmentLabel?: string
}

export interface IncomeItem {
  sourceId: string
  name: string
  amount: number
  date: ISODate
}

export interface CycleProjection {
  cycle: FinancialCycle
  /** First and last day of the cycle, and the payment day that closes it. */
  period: { start: ISODate; end: ISODate; settlement: ISODate }
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
    /** Sorted by date. */
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

/** Cycle in progress today — the dashboard's "current" cycle. */
export function currentCycle(data: Pick<FinancialData, 'defaultPaymentDay'>, today: ISODate): FinancialCycle {
  return cycleOfDate(today, data.defaultPaymentDay)
}

// ---------------------------------------------------------------- regular expenses and income

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

/** Payment date of a monthly/annual expense paid by `cycle`, or `null` if it has none in that cycle. */
export function recurringPaymentDate(rule: RecurringRule, cycle: FinancialCycle, defaultPaymentDay: number): ISODate | null {
  const day = effectivePaymentDay(rule, defaultPaymentDay)
  const month = obligationMonth(cycle, day, defaultPaymentDay)
  // For annual expenses, `chargeMonth` is the calendar month of the payment.
  if (rule.recurrence === 'ANNUAL' && rule.chargeMonth !== month.month) return null
  const date = dateInMonth(month, day)
  // Only payments on or after the start date count.
  return compareDates(date, parseISODate(rule.startDate)) >= 0 ? toISODate(date) : null
}

/** Date an income source is received within `cycle`, or `null`. */
export function incomeDateInCycle(source: IncomeSource, cycle: FinancialCycle, defaultPaymentDay: number): ISODate | null {
  const first = parseISODate(source.expectedDate)
  if (source.recurrence === 'OCCASIONAL') {
    return sameMonth(cycleOfDate(first, defaultPaymentDay), cycle) ? source.expectedDate : null
  }
  // Received on/after the payment day → that month's cycle; before it → still the previous cycle.
  // Compared on the nominal day so a monthly income lands exactly once per cycle.
  const month = first.day >= defaultPaymentDay ? cycle : addMonths(cycle, 1)
  if (source.recurrence === 'ANNUAL' && month.month !== first.month) return null
  const date = dateInMonth(month, first.day)
  return compareDates(date, first) >= 0 ? toISODate(date) : null
}

// ---------------------------------------------------------------- purchases

const cardOf = (method: string, cardId: string | null, cards: CardLookup) =>
  method === 'CREDIT_CARD' && cardId ? cards.get(cardId) : undefined

export interface Placement {
  cycle: FinancialCycle
  /** Real date of the (first) payment. */
  date: ISODate
  /** Statement month of the (first) payment, for card purchases. */
  statementMonth?: YearMonth
  card?: CreditCard
}

/**
 * Where a single-payment purchase lands. Credit card: its statement, then the cycle that pays it.
 * Cash/Pix (or an unknown card): the cycle in progress on the purchase date.
 */
export function placeOccasional(
  e: Pick<OccasionalExpense, 'purchaseDate' | 'paymentMethod' | 'cardId'>,
  ctx: ProjectionContext,
): Placement {
  const card = cardOf(e.paymentMethod, e.cardId, ctx.cards)
  if (card) {
    const p = placeCardPurchase(card, e.purchaseDate, ctx.defaultPaymentDay)
    return { cycle: p.cycle, date: toISODate(p.dueDate), statementMonth: p.statementMonth, card }
  }
  return { cycle: cycleOfDate(e.purchaseDate, ctx.defaultPaymentDay), date: e.purchaseDate }
}

/** Where installment `k` (0-based) lands. Consecutive installments land in consecutive cycles. */
export function placeInstallment(
  e: Pick<InstallmentExpense, 'purchaseDate' | 'paymentMethod' | 'cardId' | 'firstPaymentDate'>,
  k: number,
  ctx: ProjectionContext,
): Placement {
  const card = cardOf(e.paymentMethod, e.cardId, ctx.cards)
  if (card) {
    const first = placeCardPurchase(card, e.purchaseDate, ctx.defaultPaymentDay)
    const statementMonth = addMonths(first.statementMonth, k)
    return { cycle: addMonths(first.cycle, k), date: toISODate(statementDueDate(card, statementMonth)), statementMonth, card }
  }
  const first = parseISODate(e.firstPaymentDate ?? e.purchaseDate)
  const month = addMonths(monthOf(first), k)
  return {
    cycle: obligationCycle(month, first.day, ctx.defaultPaymentDay),
    date: toISODate(dateInMonth(month, first.day)),
  }
}

/** Charges an expense produces in a given cycle (zero or one). */
export function chargesInCycle(expense: Expense, cycle: FinancialCycle, ctx: ProjectionContext): ExpenseCharge[] {
  const base = { expenseId: expense.id, name: expense.name, type: expense.type }
  switch (expense.type) {
    case 'FIXED':
    case 'SUBSCRIPTION': {
      const date = recurringPaymentDate(expense, cycle, ctx.defaultPaymentDay)
      return date ? [{ ...base, amount: expense.amount, date }] : []
    }
    case 'OCCASIONAL': {
      const p = placeOccasional(expense, ctx)
      if (!sameMonth(p.cycle, cycle)) return []
      return [{ ...base, amount: expense.amount, date: p.date, statementMonth: p.statementMonth, cardName: p.card?.nickname }]
    }
    case 'INSTALLMENT': {
      const k = monthsBetween(placeInstallment(expense, 0, ctx).cycle, cycle)
      if (k < 0 || k >= expense.installmentsCount) return []
      const p = placeInstallment(expense, k, ctx)
      return [
        {
          ...base,
          amount: expense.installmentAmount,
          date: p.date,
          statementMonth: p.statementMonth,
          cardName: p.card?.nickname,
          installmentLabel: `${k + 1}/${expense.installmentsCount}`,
        },
      ]
    }
  }
}

/** Last cycle affected by an expense; `null` for open-ended recurring expenses. */
export function lastChargeCycle(expense: NewExpense, data: Pick<FinancialData, 'cards' | 'defaultPaymentDay'>): FinancialCycle | null {
  const ctx = projectionContext(data)
  switch (expense.type) {
    case 'FIXED':
    case 'SUBSCRIPTION':
      return null
    case 'OCCASIONAL':
      return placeOccasional(expense, ctx).cycle
    case 'INSTALLMENT':
      return placeInstallment(expense, expense.installmentsCount - 1, ctx).cycle
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

function project(data: FinancialData, cycle: FinancialCycle, ctx: ProjectionContext): CycleProjection {
  const day = ctx.defaultPaymentDay
  const salary = salaryForMonth(data, cycle)
  const incomeItems: IncomeItem[] = data.incomeSources.flatMap((s) => {
    const date = incomeDateInCycle(s, cycle, day)
    return date ? [{ sourceId: s.id, name: s.name, amount: s.amount, date }] : []
  })
  const otherIncome = sumMoney(incomeItems.map((i) => i.amount))
  const incomeTotal = roundMoney(salary.amount + otherIncome)

  const items = data.expenses
    .flatMap((e) => chargesInCycle(e, cycle, ctx))
    .sort((a, b) => a.date.localeCompare(b.date))
  const totalOf = (type: ExpenseType) => sumMoney(items.filter((i) => i.type === type).map((i) => i.amount))
  const expenseTotal = sumMoney(items.map((i) => i.amount))

  return {
    cycle,
    period: {
      start: toISODate(cycleStart(cycle, day)),
      end: toISODate(cycleEnd(cycle, day)),
      settlement: toISODate(cycleSettlementDate(cycle, day)),
    },
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

export function projectCycle(data: FinancialData, cycle: FinancialCycle): CycleProjection {
  return project(data, cycle, projectionContext(data))
}

/** Projects `count` consecutive cycles starting at `start`. Not limited to any horizon. */
export function projectCycles(data: FinancialData, start: FinancialCycle, count: number): CycleProjection[] {
  const ctx = projectionContext(data)
  return Array.from({ length: count }, (_, i) => project(data, addMonths(start, i), ctx))
}
