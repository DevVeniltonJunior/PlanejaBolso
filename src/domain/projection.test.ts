import { describe, expect, it } from 'vitest'
import { billingMonth, statementClosingDate } from './billing'
import { addMonths, dateInMonth, toISODate, type YearMonth } from './dates'
import { parseMoney } from './money'
import { incomeAppliesTo, projectMonth, projectMonths, recurringAppliesTo } from './projection'
import { averageNetSalary, salaryForMonth } from './salary'
import { simulatePurchase, simulationToExpense } from './simulation'
import type { CreditCard, Expense, FinancialData, IncomeSource, SalaryEntry } from './types'
import { EMPTY_DATA } from './types'

const ym = (year: number, month: number): YearMonth => ({ year, month })
const data = (patch: Partial<FinancialData>): FinancialData => ({ ...EMPTY_DATA, ...patch })

// Due on the 5th, closes 7 days before (e.g. Nov 5 → Oct 29).
const card: CreditCard = { id: 'c1', nickname: 'Final 42', dueDay: 5, closingDaysBefore: 7 }

const fixed = (patch: Partial<Extract<Expense, { type: 'FIXED' }>> = {}): Expense => ({
  id: 'f1',
  type: 'FIXED',
  name: 'Luz',
  amount: 200,
  recurrence: 'MONTHLY',
  category: 'BILL',
  chargeDay: 10,
  chargeMonth: null,
  startDate: '2026-01-01',
  ...patch,
})

function deepFreeze<T>(obj: T): T {
  Object.values(obj as object).forEach((v) => v && typeof v === 'object' && deepFreeze(v))
  return Object.freeze(obj)
}

describe('dates', () => {
  it('adds months across year boundaries', () => {
    expect(addMonths(ym(2026, 11), 3)).toEqual(ym(2027, 2))
    expect(addMonths(ym(2027, 1), -1)).toEqual(ym(2026, 12))
  })
  it('clamps days to month length', () => {
    expect(toISODate(dateInMonth(ym(2027, 2), 31))).toBe('2027-02-28')
    expect(toISODate(dateInMonth(ym(2028, 2), 31))).toBe('2028-02-29')
  })
})

describe('money', () => {
  it('parses Brazilian and plain formats', () => {
    expect(parseMoney('1.250,50')).toBe(1250.5)
    expect(parseMoney('R$ 8.000')).toBe(8000)
    expect(parseMoney('1250.5')).toBe(1250.5)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
  })
})

describe('credit card billing', () => {
  it('computes closing date from due date', () => {
    expect(toISODate(statementClosingDate(card, ym(2026, 11)))).toBe('2026-10-29')
    // Across a year boundary: Jan 5 → Dec 29
    expect(toISODate(statementClosingDate(card, ym(2027, 1)))).toBe('2026-12-29')
  })
  it('assigns purchases before closing to the current statement', () => {
    expect(billingMonth(card, '2026-10-20')).toEqual(ym(2026, 11))
    expect(billingMonth(card, '2026-10-28')).toEqual(ym(2026, 11))
  })
  it('assigns purchases on/after closing to the next statement', () => {
    expect(billingMonth(card, '2026-10-29')).toEqual(ym(2026, 12))
    expect(billingMonth(card, '2026-10-30')).toEqual(ym(2026, 12))
  })
  it('handles year transitions', () => {
    expect(billingMonth(card, '2026-12-30')).toEqual(ym(2027, 2))
    expect(billingMonth(card, '2026-12-28')).toEqual(ym(2027, 1))
  })
  it('handles due dates later in the month and short months', () => {
    const late: CreditCard = { id: 'c2', nickname: 'X', dueDay: 31, closingDaysBefore: 10 }
    // Feb 2027 due date is the 28th → closes Feb 18
    expect(toISODate(statementClosingDate(late, ym(2027, 2)))).toBe('2027-02-18')
    expect(billingMonth(late, '2027-02-17')).toEqual(ym(2027, 2))
    expect(billingMonth(late, '2027-02-18')).toEqual(ym(2027, 3))
    expect(billingMonth(late, '2026-10-05')).toEqual(ym(2026, 10))
  })
})

describe('recurring expenses', () => {
  it('monthly expenses apply every month from the start date', () => {
    const e = fixed({ startDate: '2026-10-15', chargeDay: 10 })
    if (e.type !== 'FIXED') throw new Error()
    expect(recurringAppliesTo(e, ym(2026, 9))).toBe(false)
    expect(recurringAppliesTo(e, ym(2026, 10))).toBe(false) // Oct 10 is before start
    expect(recurringAppliesTo(e, ym(2026, 11))).toBe(true)
    expect(recurringAppliesTo(e, ym(2027, 1))).toBe(true)
  })
  it('annual expenses apply only in their month, across years', () => {
    const e = fixed({ recurrence: 'ANNUAL', chargeMonth: 1, chargeDay: 20, startDate: '2026-01-01', category: 'TAX' })
    const d = data({ expenses: [e] })
    const totals = projectMonths(d, ym(2026, 11), 4).map((p) => p.expenses.fixed)
    expect(totals).toEqual([0, 0, 200, 0]) // Nov, Dec, Jan/2027, Feb
  })
  it('subscriptions are projected into future months', () => {
    const sub: Expense = {
      id: 's1', type: 'SUBSCRIPTION', name: 'Streaming', amount: 39.9,
      recurrence: 'MONTHLY', chargeDay: 1, chargeMonth: null, startDate: '2026-01-01',
    }
    const p = projectMonths(data({ expenses: [sub] }), ym(2026, 10), 3)
    expect(p.map((m) => m.expenses.subscriptions)).toEqual([39.9, 39.9, 39.9])
  })
})

describe('installments', () => {
  const notebook: Expense = {
    id: 'i1', type: 'INSTALLMENT', name: 'Notebook', installmentAmount: 500, installmentsCount: 10,
    purchaseDate: '2026-10-20', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null,
  }
  it('starts on the computed statement and runs for every installment', () => {
    const d = data({ cards: [card], expenses: [notebook] })
    const p = projectMonths(d, ym(2026, 10), 13)
    expect(p.map((m) => m.expenses.installments)).toEqual([0, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 0, 0])
    expect(p[1].expenses.items[0].installmentLabel).toBe('1/10')
    expect(p[3].month).toEqual(ym(2027, 1))
    expect(p[3].expenses.items[0].installmentLabel).toBe('3/10')
  })
  it('purchases after closing start one statement later', () => {
    const d = data({ cards: [card], expenses: [{ ...notebook, purchaseDate: '2026-10-30' }] })
    expect(projectMonth(d, ym(2026, 11)).expenses.installments).toBe(0)
    expect(projectMonth(d, ym(2026, 12)).expenses.items[0].installmentLabel).toBe('1/10')
    expect(projectMonth(d, ym(2027, 9)).expenses.items[0].installmentLabel).toBe('10/10')
    expect(projectMonth(d, ym(2027, 10)).expenses.installments).toBe(0)
  })
  it('non-card installments start on the first payment date', () => {
    const e: Expense = {
      ...notebook, installmentsCount: 3, paymentMethod: 'PIX', cardId: null, firstPaymentDate: '2026-12-15',
    }
    const p = projectMonths(data({ expenses: [e] }), ym(2026, 11), 5)
    expect(p.map((m) => m.expenses.installments)).toEqual([0, 500, 500, 500, 0])
  })
})

describe('occasional expenses', () => {
  it('cash/pix count in the purchase month; card in the statement month', () => {
    const expenses: Expense[] = [
      { id: 'o1', type: 'OCCASIONAL', name: 'Mercado', amount: 300, purchaseDate: '2026-10-10', paymentMethod: 'PIX', cardId: null },
      { id: 'o2', type: 'OCCASIONAL', name: 'Farmácia', amount: 80, purchaseDate: '2026-10-30', paymentMethod: 'CREDIT_CARD', cardId: 'c1' },
    ]
    const p = projectMonths(data({ cards: [card], expenses }), ym(2026, 10), 3)
    expect(p.map((m) => m.expenses.occasional)).toEqual([300, 0, 80])
  })
})

describe('income', () => {
  const rent: IncomeSource = { id: 'r', name: 'Aluguel', amount: 1800, type: 'RENT', recurrence: 'MONTHLY', expectedDate: '2026-09-10' }
  it('projects recurring and occasional income', () => {
    const bonus: IncomeSource = { id: 'b', name: 'Bônus', amount: 1000, type: 'OTHER', recurrence: 'ANNUAL', expectedDate: '2025-12-20' }
    const freela: IncomeSource = { id: 'f', name: 'Freela', amount: 700, type: 'FREELANCE', recurrence: 'OCCASIONAL', expectedDate: '2026-11-03' }
    expect(incomeAppliesTo(rent, ym(2026, 8))).toBe(false)
    expect(incomeAppliesTo(rent, ym(2027, 3))).toBe(true)
    const p = projectMonths(data({ incomeSources: [rent, bonus, freela] }), ym(2026, 10), 4)
    expect(p.map((m) => m.income.other)).toEqual([1800, 2500, 2800, 1800])
  })
})

describe('salary', () => {
  const entry = (month: string, netAmount: number): SalaryEntry => ({ id: month, referenceMonth: `${month}-01`, netAmount, receiptDate: null })
  const history = [
    entry('2026-03', 1000), entry('2026-04', 1000), // outside the 6-month window
    entry('2026-05', 6900), entry('2026-06', 7000),
    entry('2026-07', 6850), entry('2026-08', 7120), entry('2026-09', 6940), entry('2026-10', 7050),
  ]
  it('averages the latest six months', () => {
    expect(averageNetSalary(history)).toBe(6976.67)
  })
  it('uses all entries when fewer than six exist', () => {
    expect(averageNetSalary(history.slice(-2))).toBe(6995)
    expect(averageNetSalary([])).toBeNull()
  })
  it('prefers actual value, then average, then fixed salary', () => {
    const d = { fixedSalary: 8000, salaryHistory: history }
    expect(salaryForMonth(d, ym(2026, 10))).toEqual({ amount: 7050, source: 'ACTUAL' })
    expect(salaryForMonth(d, ym(2026, 11))).toEqual({ amount: 6976.67, source: 'AVERAGE' })
    expect(salaryForMonth({ fixedSalary: 8000, salaryHistory: history.slice(-2) }, ym(2026, 11)).source).toBe('FIXED')
    expect(salaryForMonth({ fixedSalary: null, salaryHistory: history.slice(-1) }, ym(2026, 11)).source).toBe('AVERAGE')
    expect(salaryForMonth({ fixedSalary: null, salaryHistory: [] }, ym(2026, 11))).toEqual({ amount: 0, source: 'NONE' })
  })
})

describe('balance and commitment', () => {
  it('computes expected balance and income commitment', () => {
    const d = data({ fixedSalary: 7000, expenses: [fixed({ amount: 5200 })] })
    const p = projectMonth(d, ym(2026, 10))
    expect(p.income.total).toBe(7000)
    expect(p.expenses.total).toBe(5200)
    expect(p.balance).toBe(1800)
    expect(p.commitment).toBeCloseTo(74.2857, 3)
  })
  it('has no commitment when no income is expected', () => {
    expect(projectMonth(data({ expenses: [fixed()] }), ym(2026, 10)).commitment).toBeNull()
  })
})

describe('purchase simulation', () => {
  const base = () => data({ fixedSalary: 7000, cards: [card], expenses: [fixed({ amount: 5200 })] })

  it('compares before/after for a single payment', () => {
    const r = simulatePurchase(base(), { amount: 500, paymentMethod: 'PIX', installments: 1, purchaseDate: '2026-10-18' }, ym(2026, 10))
    expect(r.rows).toHaveLength(3)
    expect(r.rows.map((x) => x.before.balance)).toEqual([1800, 1800, 1800])
    expect(r.rows.map((x) => x.after.balance)).toEqual([1300, 1800, 1800])
    expect(r.rows[0].after.commitment).toBeCloseTo(81.4286, 3)
  })

  it('covers every month affected by installments', () => {
    const r = simulatePurchase(
      base(),
      { description: 'TV', amount: 3000, paymentMethod: 'CREDIT_CARD', cardId: 'c1', installments: 6, purchaseDate: '2026-10-18' },
      ym(2026, 10),
    )
    // Statements Nov/2026 … Apr/2027 → 7 months from October
    expect(r.rows).toHaveLength(7)
    expect(r.rows.map((x) => x.balanceDifference)).toEqual([0, -500, -500, -500, -500, -500, -500])
    expect(r.rows[6].month).toEqual(ym(2027, 4))
  })

  it('does not modify persisted data', () => {
    const d = deepFreeze(base())
    const snapshot = JSON.stringify(d)
    simulatePurchase(d, { amount: 999, paymentMethod: 'CREDIT_CARD', cardId: 'c1', installments: 3, purchaseDate: '2026-10-18' }, ym(2026, 10))
    expect(JSON.stringify(d)).toBe(snapshot)
    expect(projectMonth(d, ym(2026, 11)).balance).toBe(1800)
  })

  it('converts a simulation into an equivalent expense', () => {
    const input = { description: 'TV', amount: 3000, paymentMethod: 'CREDIT_CARD' as const, cardId: 'c1', installments: 6, purchaseDate: '2026-10-18' }
    const expense = simulationToExpense(input)
    expect(expense).toEqual({
      type: 'INSTALLMENT', name: 'TV', installmentAmount: 500, installmentsCount: 6,
      purchaseDate: '2026-10-18', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null,
    })
    expect(simulationToExpense({ amount: 50, paymentMethod: 'CASH', cardId: 'c1', installments: 1, purchaseDate: '2026-10-18' })).toEqual({
      type: 'OCCASIONAL', name: 'Compra simulada', amount: 50, purchaseDate: '2026-10-18', paymentMethod: 'CASH', cardId: null,
    })

    // Once persisted, the regular projection matches the simulated "after" projection.
    const sim = simulatePurchase(base(), input, ym(2026, 10))
    const persisted = data({ ...base(), expenses: [...base().expenses, { ...expense, id: 'new' }] })
    expect(projectMonths(persisted, ym(2026, 10), sim.rows.length).map((p) => p.balance)).toEqual(sim.rows.map((r) => r.after.balance))
  })
})
