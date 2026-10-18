import { describe, expect, it } from 'vitest'
import { addMonths, dateInMonth, toISODate, type YearMonth } from './dates'
import { parseMoney } from './money'
import {
  currentCycle,
  effectivePaymentDay,
  incomeDateInCycle,
  projectCycle,
  projectCycles,
  recurringPaymentDate,
  type CycleProjection,
} from './projection'
import { averageNetSalary, salaryForMonth } from './salary'
import { SIMULATION_EXPENSE_ID, simulatePurchase, simulationToExpense } from './simulation'
import type { CreditCard, Expense, FinancialData, IncomeSource, SalaryEntry } from './types'
import { EMPTY_DATA } from './types'

const ym = (year: number, month: number): YearMonth => ({ year, month })
const data = (patch: Partial<FinancialData>): FinancialData => ({ ...EMPTY_DATA, ...patch })

// Due on the 5th, closes 7 days before (e.g. Nov 5 → Oct 29). The default payment day is also 5.
const card: CreditCard = { id: 'c1', nickname: 'Final 42', dueDay: 5, closingDaysBefore: 7 }
// Due on the 25th, closes on the 18th of the same month.
const lateCard: CreditCard = { id: 'c3', nickname: 'Vence 25', dueDay: 25, closingDaysBefore: 7 }

const fixed = (patch: Partial<Extract<Expense, { type: 'FIXED' }>> = {}): Expense => ({
  id: 'f1',
  type: 'FIXED',
  name: 'Luz',
  amount: 200,
  recurrence: 'MONTHLY',
  category: 'BILL',
  paymentDayOverride: null,
  chargeMonth: null,
  startDate: '2026-01-01',
  ...patch,
})

const subscription = (patch: Partial<Extract<Expense, { type: 'SUBSCRIPTION' }>> = {}): Expense => ({
  id: 's1',
  type: 'SUBSCRIPTION',
  name: 'Streaming',
  amount: 39.9,
  recurrence: 'MONTHLY',
  paymentDayOverride: null,
  chargeMonth: null,
  startDate: '2026-01-01',
  ...patch,
})

const occasional = (id: string, purchaseDate: string, cardId: string | null, amount = 100): Expense => ({
  id, type: 'OCCASIONAL', name: id, amount, purchaseDate, paymentMethod: cardId ? 'CREDIT_CARD' : 'PIX', cardId,
})

const installment = (patch: Partial<Extract<Expense, { type: 'INSTALLMENT' }>>): Expense => ({
  id: 'i1', type: 'INSTALLMENT', name: 'Notebook', installmentAmount: 500, installmentsCount: 10,
  purchaseDate: '2026-10-20', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null,
  ...patch,
})

/** "name@date" for each expense charged in the cycle, in date order. */
const charges = (p: CycleProjection) => p.expenses.items.map((i) => `${i.name}@${i.date}`)

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

describe('current cycle', () => {
  it('is the cycle in progress today', () => {
    expect(currentCycle({ defaultPaymentDay: 5 }, '2026-10-18')).toEqual(ym(2026, 10))
    expect(currentCycle({ defaultPaymentDay: 5 }, '2026-11-03')).toEqual(ym(2026, 10))
    expect(currentCycle({ defaultPaymentDay: 5 }, '2026-11-05')).toEqual(ym(2026, 11))
    expect(currentCycle({ defaultPaymentDay: 20 }, '2026-10-18')).toEqual(ym(2026, 9))
    expect(currentCycle({ defaultPaymentDay: 5 }, '2027-01-02')).toEqual(ym(2026, 12))
  })
  it('exposes the cycle period', () => {
    expect(projectCycle(data({}), ym(2026, 10)).period).toEqual({ start: '2026-10-05', end: '2026-11-04', settlement: '2026-11-05' })
  })
})

describe('regular expenses and payment days', () => {
  it('on the default payment day, they close the cycle (October cycle pays on 05/11)', () => {
    const d = data({ defaultPaymentDay: 5, expenses: [fixed(), subscription()] })
    expect(charges(projectCycle(d, ym(2026, 10)))).toEqual(['Luz@2026-11-05', 'Streaming@2026-11-05'])
  })

  it('falls back to day 5 when the user has not configured one', () => {
    expect(EMPTY_DATA.defaultPaymentDay).toBe(5)
    expect(charges(projectCycle(data({ expenses: [fixed()] }), ym(2026, 10)))).toEqual(['Luz@2026-11-05'])
  })

  it('an override takes precedence and is placed in the cycle that pays it', () => {
    const car = fixed({ id: 'car', name: 'Carro', paymentDayOverride: 17, category: 'OTHER' })
    const gym = fixed({ id: 'gym', name: 'Academia', paymentDayOverride: 3 })
    const d = data({ defaultPaymentDay: 5, expenses: [car, gym, fixed()] })
    // October cycle (05/10 → 04/11, closing on 05/11): car on 17/10, gym on 03/11, bills on 05/11.
    expect(charges(projectCycle(d, ym(2026, 10)))).toEqual(['Carro@2026-10-17', 'Academia@2026-11-03', 'Luz@2026-11-05'])
    expect(effectivePaymentDay({ paymentDayOverride: 17 }, 5)).toBe(17)
    expect(effectivePaymentDay({ paymentDayOverride: null }, 5)).toBe(5)
  })

  it('each regular expense is charged exactly once per cycle', () => {
    const d = data({ defaultPaymentDay: 5, expenses: [fixed({ paymentDayOverride: 17 }), fixed({ id: 'x', paymentDayOverride: 3 }), fixed({ id: 'y' })] })
    expect(projectCycles(d, ym(2026, 10), 15).map((p) => p.expenses.items.length)).toEqual(Array(15).fill(3))
  })

  it('changing the default moves cycle boundaries and expenses without override', () => {
    const car = fixed({ id: 'car', name: 'Carro', paymentDayOverride: 17 })
    const d = data({ defaultPaymentDay: 10, expenses: [car, fixed()] })
    // October cycle with day 10: 10/10 → 09/11, closing on 10/11.
    expect(charges(projectCycle(d, ym(2026, 10)))).toEqual(['Carro@2026-10-17', 'Luz@2026-11-10'])
    // With day 20 the car payment (day 17) closes the previous cycle instead.
    expect(charges(projectCycle({ ...d, defaultPaymentDay: 20 }, ym(2026, 10)))).toEqual(['Carro@2026-11-17', 'Luz@2026-11-20'])
  })

  it('only counts payments on or after the start date', () => {
    const e = fixed({ startDate: '2026-10-15', paymentDayOverride: 10 })
    if (e.type !== 'FIXED') throw new Error()
    expect(recurringPaymentDate(e, ym(2026, 9), 5)).toBeNull()
    expect(recurringPaymentDate(e, ym(2026, 10), 5)).toBeNull() // 10/10 is before the start
    expect(recurringPaymentDate(e, ym(2026, 11), 5)).toBe('2026-11-10')
    expect(recurringPaymentDate(e, ym(2027, 1), 5)).toBe('2027-01-10')

    // Starting 10/10 on the default day 5: first payment is 05/11, which closes the October cycle.
    const onDefault = fixed({ startDate: '2026-10-10' })
    expect(projectCycles(data({ expenses: [onDefault] }), ym(2026, 9), 3).map((p) => p.expenses.fixed)).toEqual([0, 200, 200])
    // Same start with an override on day 7: 07/10 is before the start → first payment 07/11 (November cycle).
    const onSeventh = fixed({ startDate: '2026-10-10', paymentDayOverride: 7 })
    expect(projectCycles(data({ expenses: [onSeventh] }), ym(2026, 9), 3).map((p) => p.expenses.fixed)).toEqual([0, 0, 200])
  })

  it('annual expenses: the calendar month of payment combined with the payment day', () => {
    const ipva = fixed({ name: 'IPVA', recurrence: 'ANNUAL', chargeMonth: 1, category: 'TAX' })
    // Paid 05/01/2027 (default day) → closes the December 2026 cycle.
    expect(projectCycles(data({ expenses: [ipva] }), ym(2026, 11), 4).map((p) => p.expenses.fixed)).toEqual([0, 200, 0, 0])
    expect(charges(projectCycle(data({ expenses: [ipva] }), ym(2026, 12)))).toEqual(['IPVA@2027-01-05'])
    // Paid 20/01/2027 (override) → January 2027 cycle.
    const late = fixed({ name: 'IPVA', recurrence: 'ANNUAL', chargeMonth: 1, paymentDayOverride: 20, category: 'TAX' })
    expect(projectCycles(data({ expenses: [late] }), ym(2026, 11), 4).map((p) => p.expenses.fixed)).toEqual([0, 0, 200, 0])
  })

  it('clamps payment days in short months and leap years', () => {
    const d = data({ defaultPaymentDay: 31, expenses: [fixed()] })
    expect(charges(projectCycle(d, ym(2027, 1)))).toEqual(['Luz@2027-02-28'])
    expect(charges(projectCycle(d, ym(2028, 1)))).toEqual(['Luz@2028-02-29'])
    expect(charges(projectCycle(d, ym(2026, 3)))).toEqual(['Luz@2026-04-30'])
    // Payment day 30 with an override on day 31: one payment per cycle, even through February.
    const e = data({ defaultPaymentDay: 30, expenses: [fixed({ paymentDayOverride: 31 })] })
    expect(projectCycles(e, ym(2027, 1), 3).map(charges)).toEqual([['Luz@2027-01-31'], ['Luz@2027-02-28'], ['Luz@2027-03-31']])
  })

  it('subscriptions are projected into future cycles', () => {
    expect(projectCycles(data({ expenses: [subscription()] }), ym(2026, 10), 3).map((m) => m.expenses.subscriptions)).toEqual([39.9, 39.9, 39.9])
  })
})

describe('credit card purchases in cycles', () => {
  it('statement due 05/11 → October cycle; statement due 05/12 → November cycle', () => {
    const d = data({ cards: [card], expenses: [occasional('Oct20', '2026-10-20', 'c1'), occasional('Oct30', '2026-10-30', 'c1')] })
    const [oct, nov] = projectCycles(d, ym(2026, 10), 2)
    expect(charges(oct)).toEqual(['Oct20@2026-11-05'])
    expect(charges(nov)).toEqual(['Oct30@2026-12-05'])
    expect(oct.expenses.items[0]).toMatchObject({ statementMonth: ym(2026, 11), cardName: 'Final 42' })
  })

  it('before, on and after closing', () => {
    const d = data({
      cards: [card],
      expenses: [occasional('before', '2026-10-28', 'c1'), occasional('closing', '2026-10-29', 'c1'), occasional('after', '2026-10-30', 'c1')],
    })
    const [sep, oct, nov] = projectCycles(d, ym(2026, 9), 3)
    expect(sep.expenses.items).toEqual([])
    expect(charges(oct)).toEqual(['before@2026-11-05'])
    expect(charges(nov)).toEqual(['closing@2026-12-05', 'after@2026-12-05'])
  })

  it("same-month statements are paid by that month's cycle", () => {
    const d = data({ cards: [lateCard], expenses: [occasional('a', '2026-10-10', 'c3'), occasional('b', '2026-10-18', 'c3')] })
    const [oct, nov] = projectCycles(d, ym(2026, 10), 2)
    expect(charges(oct)).toEqual(['a@2026-10-25'])
    expect(charges(nov)).toEqual(['b@2026-11-25'])
  })

  it('cards with different due days share a cycle by who pays them', () => {
    const day10: CreditCard = { id: 'c10', nickname: 'Vence 10', dueDay: 10, closingDaysBefore: 7 }
    const d = data({
      cards: [card, day10, lateCard],
      expenses: [occasional('a', '2026-10-20', 'c1'), occasional('b', '2026-10-20', 'c10'), occasional('c', '2026-10-20', 'c3')],
    })
    const [oct, nov] = projectCycles(d, ym(2026, 10), 2)
    expect(charges(oct)).toEqual(['a@2026-11-05']) // due 05/11 closes October
    expect(charges(nov)).toEqual(['b@2026-11-10', 'c@2026-11-25']) // after the payment day → November
  })

  it('crosses the year boundary', () => {
    const d = data({
      cards: [card, lateCard],
      expenses: [occasional('a', '2026-12-28', 'c1'), occasional('b', '2026-12-29', 'c1'), occasional('c', '2026-12-18', 'c3')],
    })
    const [dec, jan, feb] = projectCycles(d, ym(2026, 12), 3)
    expect(charges(dec)).toEqual(['a@2027-01-05'])
    expect(charges(jan)).toEqual(['c@2027-01-25', 'b@2027-02-05'])
    expect(feb.expenses.items).toEqual([])
  })

  it('the payment day never changes the statement or its due date', () => {
    const expenses = [occasional('a', '2026-10-20', 'c1'), occasional('b', '2026-10-10', 'c3'), installment({ installmentsCount: 3, purchaseDate: '2026-10-30' })]
    const billing = (defaultPaymentDay: number) =>
      projectCycles(data({ defaultPaymentDay, cards: [card, lateCard], expenses }), ym(2026, 8), 10)
        .flatMap((p) => p.expenses.items.map((i) => ({ name: i.name, date: i.date, statement: i.statementMonth })))
        .sort((x, y) => (x.date + x.name).localeCompare(y.date + y.name))
    expect(billing(1)).toEqual(billing(5))
    expect(billing(5)).toEqual(billing(28))
  })

  it('an unknown card falls back to the cycle of the purchase date', () => {
    const d = data({ expenses: [occasional('x', '2026-10-10', 'missing')] })
    expect(projectCycles(d, ym(2026, 10), 2).map((m) => m.expenses.occasional)).toEqual([100, 0])
  })
})

describe('installments in cycles', () => {
  it('card installments start in the cycle paying the first statement, then consecutive cycles', () => {
    const p = projectCycles(data({ cards: [card], expenses: [installment({})] }), ym(2026, 10), 13)
    expect(p.map((m) => m.expenses.installments)).toEqual([...Array(10).fill(500), 0, 0, 0])
    expect(p[0].expenses.items[0]).toMatchObject({ installmentLabel: '1/10', date: '2026-11-05', statementMonth: ym(2026, 11) })
    expect(p[9].expenses.items[0]).toMatchObject({ installmentLabel: '10/10', date: '2027-08-05' })
  })

  it('after closing, they start one cycle later', () => {
    const d = data({ cards: [card], expenses: [installment({ purchaseDate: '2026-10-30' })] })
    expect(projectCycle(d, ym(2026, 10)).expenses.installments).toBe(0)
    expect(projectCycle(d, ym(2026, 11)).expenses.items[0]).toMatchObject({ installmentLabel: '1/10', date: '2026-12-05' })
    expect(projectCycle(d, ym(2027, 8)).expenses.items[0].installmentLabel).toBe('10/10')
    expect(projectCycle(d, ym(2027, 9)).expenses.installments).toBe(0)
  })

  it('across the year boundary', () => {
    // Nov 29 is after the Dec 5 statement closed (Nov 28) → statements Jan–Apr 2027 → cycles Dec–Mar.
    const d = data({ cards: [card], expenses: [installment({ name: 'TV', installmentAmount: 250, installmentsCount: 4, purchaseDate: '2026-11-29' })] })
    const p = projectCycles(d, ym(2026, 11), 7)
    expect(p.map((m) => m.expenses.installments)).toEqual([0, 250, 250, 250, 250, 0, 0])
    expect(p.slice(1, 5).map(charges)).toEqual([['TV@2027-01-05'], ['TV@2027-02-05'], ['TV@2027-03-05'], ['TV@2027-04-05']])
  })

  it('on a same-month statement card', () => {
    const run = (purchaseDate: string) =>
      projectCycles(
        data({ cards: [lateCard], expenses: [installment({ cardId: 'c3', installmentAmount: 300, installmentsCount: 3, purchaseDate })] }),
        ym(2026, 12),
        5,
      ).map((m) => m.expenses.installments)
    expect(run('2026-12-10')).toEqual([300, 300, 300, 0, 0]) // statements Dec, Jan, Feb (due 25 → same cycle)
    expect(run('2026-12-18')).toEqual([0, 300, 300, 300, 0]) // closing day → Jan, Feb, Mar
  })

  it('non-card installments follow their first payment date, placed like any obligation', () => {
    const later = installment({ installmentsCount: 3, paymentMethod: 'PIX', cardId: null, firstPaymentDate: '2026-12-15' })
    expect(projectCycles(data({ expenses: [later] }), ym(2026, 11), 5).map((m) => m.expenses.installments)).toEqual([0, 500, 500, 500, 0])
    // First payment on the payment day (05/11) → it closes the October cycle.
    const onPaymentDay = installment({ installmentsCount: 2, paymentMethod: 'PIX', cardId: null, firstPaymentDate: '2026-11-05' })
    expect(projectCycles(data({ expenses: [onPaymentDay] }), ym(2026, 10), 3).map(charges)).toEqual([
      ['Notebook@2026-11-05'],
      ['Notebook@2026-12-05'],
      [],
    ])
  })

  it('ignores firstPaymentDate for card installments', () => {
    const e = installment({ installmentAmount: 100, installmentsCount: 2, purchaseDate: '2026-10-10', firstPaymentDate: '2026-10-10' })
    expect(projectCycles(data({ cards: [card], expenses: [e] }), ym(2026, 10), 3).map((m) => m.expenses.installments)).toEqual([100, 100, 0])
  })
})

describe('Cash/Pix purchases', () => {
  it('count on the purchase date, in the cycle in progress', () => {
    const d = data({
      expenses: [occasional('a', '2026-10-12', null), occasional('b', '2026-10-03', null), occasional('c', '2026-11-04', null), occasional('d', '2026-11-05', null)],
    })
    const [sep, oct, nov] = projectCycles(d, ym(2026, 9), 3)
    expect(charges(sep)).toEqual(['b@2026-10-03'])
    expect(charges(oct)).toEqual(['a@2026-10-12', 'c@2026-11-04'])
    expect(charges(nov)).toEqual(['d@2026-11-05'])
  })
  it('mix with card purchases by cycle', () => {
    const expenses = [occasional('Mercado', '2026-10-10', null, 300), occasional('Feira', '2026-12-31', null, 50), occasional('Farmácia', '2026-10-30', 'c1', 80)]
    expect(projectCycles(data({ cards: [card], expenses }), ym(2026, 10), 4).map((m) => m.expenses.occasional)).toEqual([300, 80, 50, 0])
  })
})

describe('income', () => {
  const rent: IncomeSource = { id: 'r', name: 'Aluguel', amount: 1800, type: 'RENT', recurrence: 'MONTHLY', expectedDate: '2026-09-10' }
  it('projects recurring and occasional income into the cycle in progress when received', () => {
    const bonus: IncomeSource = { id: 'b', name: 'Bônus', amount: 1000, type: 'OTHER', recurrence: 'ANNUAL', expectedDate: '2025-12-20' }
    const freela: IncomeSource = { id: 'f', name: 'Freela', amount: 700, type: 'FREELANCE', recurrence: 'OCCASIONAL', expectedDate: '2026-11-03' }
    expect(incomeDateInCycle(rent, ym(2026, 8), 5)).toBeNull()
    expect(incomeDateInCycle(rent, ym(2027, 3), 5)).toBe('2027-03-10')
    // Freela on 03/11 arrives before the payment day → still the October cycle.
    const p = projectCycles(data({ incomeSources: [rent, bonus, freela] }), ym(2026, 10), 4)
    expect(p.map((m) => m.income.other)).toEqual([2500, 1800, 2800, 1800])
  })
  it('monthly income received before the payment day belongs to the previous cycle', () => {
    const early: IncomeSource = { ...rent, expectedDate: '2026-10-03' }
    expect(incomeDateInCycle(early, ym(2026, 9), 5)).toBe('2026-10-03')
    expect(incomeDateInCycle(early, ym(2026, 10), 5)).toBe('2026-11-03')
    expect(incomeDateInCycle(early, ym(2026, 8), 5)).toBeNull()
  })
  it("salary of a month funds that month's cycle", () => {
    const history: SalaryEntry[] = [{ id: 's', referenceMonth: '2026-10-01', netAmount: 6850, receiptDate: '2026-11-05' }]
    const [oct, nov] = projectCycles(data({ fixedSalary: 7000, salaryHistory: history }), ym(2026, 10), 2)
    expect([oct.income.salary, oct.income.salarySource]).toEqual([6850, 'ACTUAL'])
    expect([nov.income.salary, nov.income.salarySource]).toEqual([7000, 'FIXED'])
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
  it('computes expected balance and income commitment per cycle', () => {
    const p = projectCycle(data({ fixedSalary: 7000, expenses: [fixed({ amount: 5200 })] }), ym(2026, 10))
    expect(p.income.total).toBe(7000)
    expect(p.expenses.total).toBe(5200)
    expect(p.balance).toBe(1800)
    expect(p.commitment).toBeCloseTo(74.2857, 3)
  })
  it('has no commitment when no income is expected', () => {
    expect(projectCycle(data({ expenses: [fixed()] }), ym(2026, 10)).commitment).toBeNull()
  })
})

describe('purchase simulation', () => {
  const base = () => data({ fixedSalary: 7000, cards: [card, lateCard], expenses: [fixed({ amount: 5200 })] })
  const diffs = (input: Parameters<typeof simulatePurchase>[1], d = base()) =>
    simulatePurchase(d, input, currentCycle(d, input.purchaseDate)).rows.map((r) => r.balanceDifference)

  it('compares before/after for a Pix payment in the current cycle', () => {
    const r = simulatePurchase(base(), { amount: 500, paymentMethod: 'PIX', installments: 1, purchaseDate: '2026-10-18' }, ym(2026, 10))
    expect(r.rows.map((x) => x.before.balance)).toEqual([1800, 1800, 1800])
    expect(r.rows.map((x) => x.after.balance)).toEqual([1300, 1800, 1800])
    expect(r.rows[0].after.commitment).toBeCloseTo(81.4286, 3)
  })

  it('places card purchases in the cycle that pays their statement', () => {
    const single = { amount: 400, paymentMethod: 'CREDIT_CARD' as const, cardId: 'c1', installments: 1 }
    expect(diffs({ ...single, purchaseDate: '2026-10-20' })).toEqual([-400, 0, 0]) // statement 05/11 → October
    expect(diffs({ ...single, purchaseDate: '2026-10-29' })).toEqual([0, -400, 0]) // closing day → 05/12 → November
    expect(diffs({ ...single, purchaseDate: '2026-10-30' })).toEqual([0, -400, 0])
  })

  it('same-month statements affect the current cycle', () => {
    const late = { amount: 300, paymentMethod: 'CREDIT_CARD' as const, cardId: 'c3', installments: 3 }
    expect(diffs({ ...late, purchaseDate: '2026-10-10' })).toEqual([-100, -100, -100])
    expect(diffs({ ...late, purchaseDate: '2026-10-18' })).toEqual([0, -100, -100, -100])
  })

  it('covers every cycle affected by installments', () => {
    const r = simulatePurchase(
      base(),
      { description: 'TV', amount: 3000, paymentMethod: 'CREDIT_CARD', cardId: 'c1', installments: 6, purchaseDate: '2026-10-18' },
      ym(2026, 10),
    )
    // Statements Nov/2026 … Apr/2027 → cycles Oct/2026 … Mar/2027
    expect(r.rows.map((x) => x.balanceDifference)).toEqual([-500, -500, -500, -500, -500, -500])
    expect(r.rows[5].cycle).toEqual(ym(2027, 3))
  })

  it('"before" matches the dashboard, including payment-day rules', () => {
    const d = data({
      fixedSalary: 7000,
      defaultPaymentDay: 20,
      cards: [card],
      expenses: [fixed({ startDate: '2026-10-10' }), fixed({ id: 'car', name: 'Carro', startDate: '2026-10-10', paymentDayOverride: 3 })],
    })
    const start = currentCycle(d, '2026-10-18') // day 20 → still the September cycle
    expect(start).toEqual(ym(2026, 9))
    const sim = simulatePurchase(d, { amount: 90, paymentMethod: 'PIX', installments: 1, purchaseDate: '2026-10-18' }, start)
    expect(sim.rows.map((r) => r.before)).toEqual(projectCycles(d, start, sim.rows.length))
    // Luz (20/10) closes September; Carro (03/10) is before its start, so it begins on 03/11 (October cycle).
    expect(sim.rows.map((r) => r.before.expenses.fixed)).toEqual([200, 400, 400])
    expect(sim.rows.map((r) => r.balanceDifference)).toEqual([-90, 0, 0])
  })

  it('does not modify persisted data', () => {
    const d = deepFreeze(base())
    const snapshot = JSON.stringify(d)
    simulatePurchase(d, { amount: 999, paymentMethod: 'CREDIT_CARD', cardId: 'c1', installments: 3, purchaseDate: '2026-10-18' }, ym(2026, 10))
    expect(JSON.stringify(d)).toBe(snapshot)
    expect(projectCycle(d, ym(2026, 10)).balance).toBe(1800)
  })

  it('converts a simulation into an equivalent expense', () => {
    const input = { description: 'TV', amount: 3000, paymentMethod: 'CREDIT_CARD' as const, cardId: 'c1', installments: 6, purchaseDate: '2026-10-18' }
    expect(simulationToExpense(input)).toEqual({
      type: 'INSTALLMENT', name: 'TV', installmentAmount: 500, installmentsCount: 6,
      purchaseDate: '2026-10-18', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null,
    })
    expect(simulationToExpense({ amount: 50, paymentMethod: 'CASH', cardId: 'c1', installments: 1, purchaseDate: '2026-10-18' })).toEqual({
      type: 'OCCASIONAL', name: 'Compra simulada', amount: 50, purchaseDate: '2026-10-18', paymentMethod: 'CASH', cardId: null,
    })
  })

  it('once added, the regular projection equals the simulated "after"', () => {
    for (const defaultPaymentDay of [1, 5, 20]) {
      for (const purchaseDate of ['2026-10-01', '2026-10-28', '2026-10-29', '2026-10-31', '2026-12-29']) {
        for (const cardId of ['c1', 'c3']) {
          const d = { ...base(), defaultPaymentDay }
          const input = { amount: 1200, paymentMethod: 'CREDIT_CARD' as const, cardId, installments: 4, purchaseDate }
          const start = currentCycle(d, purchaseDate)
          const sim = simulatePurchase(d, input, start)
          const persisted = { ...d, expenses: [...d.expenses, { ...simulationToExpense(input), id: 'p' }] }
          const rename = (p: CycleProjection) => ({
            ...p,
            expenses: { ...p.expenses, items: p.expenses.items.map((i) => (i.expenseId === SIMULATION_EXPENSE_ID ? { ...i, expenseId: 'p' } : i)) },
          })
          expect(projectCycles(persisted, start, sim.rows.length)).toEqual(sim.rows.map((r) => rename(r.after)))
        }
      }
    }
  })
})
