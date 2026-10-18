/**
 * Purchase simulator. It never has rules of its own: it adds a temporary hypothetical
 * expense to a *copy* of the projection input and runs the same projection engine.
 */
import type { FinancialCycle } from './cycle'
import { monthsBetween } from './dates'
import { roundMoney } from './money'
import { lastChargeCycle, projectCycles, type CycleProjection } from './projection'
import type { FinancialData, ISODate, NewExpense, PaymentMethod } from './types'

export interface PurchaseSimulationInput {
  description?: string
  /** Total purchase amount. */
  amount: number
  paymentMethod: PaymentMethod
  cardId?: string | null
  /** 1 = single payment. Installments > 1 are only allowed on credit cards. */
  installments: number
  purchaseDate: ISODate
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
  if (isCard && input.installments > 1) {
    return {
      type: 'INSTALLMENT',
      name,
      installmentAmount: installmentAmountFor(input.amount, input.installments),
      installmentsCount: input.installments,
      purchaseDate: input.purchaseDate,
      paymentMethod: 'CREDIT_CARD',
      cardId,
      firstPaymentDate: null,
    }
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
 * Before/after comparison by financial cycle from `start`, covering at least `minCycles`
 * and every cycle the purchase affects (all installments).
 */
export function simulatePurchase(
  data: FinancialData,
  input: PurchaseSimulationInput,
  start: FinancialCycle,
  minCycles = 3,
): SimulationResult {
  const expense = simulationToExpense(input)
  const last = lastChargeCycle(expense, data)
  const count = Math.max(minCycles, last ? monthsBetween(start, last) + 1 : 0)

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
