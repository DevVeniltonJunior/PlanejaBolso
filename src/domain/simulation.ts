/**
 * Purchase simulator. It never has rules of its own: it adds a temporary hypothetical
 * expense to a *copy* of the projection input and runs the same projection engine.
 */
import type { FinancialCycle } from './cycle'
import { monthIndex, monthsBetween, parseISODate } from './dates'
import { roundMoney } from './money'
import { chargeCycles, firstInstallmentDate, projectCycles, type CycleProjection } from './projection'
import type { FinancialData, ISODate, NewExpense, PaymentMethod } from './types'

export interface PurchaseSimulationInput {
  description?: string
  /** Total purchase amount. */
  amount: number
  paymentMethod: PaymentMethod
  cardId?: string | null
  /** 1 = single payment. */
  installments: number
  purchaseDate: ISODate
  /** Pix/Cash installments: month of the first installment (default: purchase date) and due day (default: its day). */
  startDate?: ISODate
  dueDay?: number
}

export interface SimulationRow {
  cycle: FinancialCycle
  before: CycleProjection
  after: CycleProjection
  balanceDifference: number
}

export interface SimulationResult {
  expense: NewExpense
  rows: SimulationRow[]
}

export const SIMULATION_EXPENSE_ID = '__simulation__'
const DEFAULT_DESCRIPTION = 'Compra simulada'

export function installmentAmountFor(total: number, installments: number): number {
  return roundMoney(total / installments)
}

/** Expense the simulated purchase would become — used both for the simulation and for "Add to my expenses". */
export function simulationToExpense(input: PurchaseSimulationInput): NewExpense {
  const name = input.description?.trim() || DEFAULT_DESCRIPTION
  const isCard = input.paymentMethod === 'CREDIT_CARD'
  const cardId = isCard ? (input.cardId ?? null) : null
  if (input.installments > 1) {
    const installment = {
      type: 'INSTALLMENT' as const,
      name,
      installmentAmount: installmentAmountFor(input.amount, input.installments),
      installmentsCount: input.installments,
      paymentMethod: input.paymentMethod,
    }
    if (isCard) return { ...installment, purchaseDate: input.purchaseDate, cardId, firstPaymentDate: null, dueDay: null }
    const start = input.startDate ?? input.purchaseDate
    const dueDay = input.dueDay ?? parseISODate(start).day
    const firstPaymentDate = firstInstallmentDate(start, dueDay)
    return { ...installment, purchaseDate: firstPaymentDate, cardId: null, firstPaymentDate, dueDay }
  }
  return {
    type: 'OCCASIONAL',
    name,
    amount: roundMoney(input.amount),
    purchaseDate: input.purchaseDate,
    paymentMethod: input.paymentMethod,
    cardId,
  }
}

/**
 * Before/after comparison by financial cycle from `start` (or the purchase's first cycle, if earlier),
 * covering at least `minCycles` and every cycle the purchase affects.
 */
export function simulatePurchase(
  data: FinancialData,
  input: PurchaseSimulationInput,
  start: FinancialCycle,
  minCycles = 3,
): SimulationResult {
  const expense = simulationToExpense(input)
  const charged = chargeCycles(expense, data)
  if (charged && monthIndex(charged.first) < monthIndex(start)) start = charged.first
  const count = Math.max(minCycles, charged ? monthsBetween(start, charged.last) + 1 : 0)

  const withPurchase: FinancialData = {
    ...data,
    expenses: [...data.expenses, { ...expense, id: SIMULATION_EXPENSE_ID }],
  }

  const before = projectCycles(data, start, count)
  const after = projectCycles(withPurchase, start, count)
  return {
    expense,
    rows: before.map((b, i) => ({
      cycle: b.cycle,
      before: b,
      after: after[i],
      balanceDifference: roundMoney(after[i].balance - b.balance),
    })),
  }
}
