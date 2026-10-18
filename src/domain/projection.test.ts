import { describe, expect, it } from 'vitest'
import { addMonths, dateInMonth, toISODate, type YearMonth } from './dates'
import { parseMoney } from './money'
import { effectivePaymentDay, incomeAppliesTo, projectMonth, projectMonths, recurringPaymentDate } from './projection'
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

describe('recurring expenses', () => {
  it('monthly expenses apply every month from the start date', () => {
    const e = fixed({ startDate: '2026-10-15', paymentDayOverride: 10 })
    if (e.type !== 'FIXED') throw new Error()
    expect(recurringPaymentDate(e, ym(2026, 9), 5)).toBeNull()
    expect(recurringPaymentDate(e, ym(2026, 10), 5)).toBeNull() // Oct 10 is before start
    expect(recurringPaymentDate(e, ym(2026, 11), 5)).toBe('2026-11-10')
    expect(recurringPaymentDate(e, ym(2027, 1), 5)).toBe('2027-01-10')
  })
  it('annual expenses apply only in their month, across years', () => {
    const e = fixed({ recurrence: 'ANNUAL', chargeMonth: 1, paymentDayOverride: 20, startDate: '2026-01-01', category: 'TAX' })
    const d = data({ expenses: [e] })
    const totals = projectMonths(d, ym(2026, 11), 4).map((p) => p.expenses.fixed)
    expect(totals).toEqual([0, 0, 200, 0]) // Nov, Dec, Jan/2027, Feb
  })
  it('subscriptions are projected into future months', () => {
    const p = projectMonths(data({ expenses: [subscription()] }), ym(2026, 10), 3)
    expect(p.map((m) => m.expenses.subscriptions)).toEqual([39.9, 39.9, 39.9])
  })
})

describe('payment days', () => {
  const dates = (d: FinancialData, month: YearMonth) => projectMonth(d, month).expenses.items.map((i) => `${i.name}@${i.date}`)

  it('regular expenses use the default payment day', () => {
    const d = data({ defaultPaymentDay: 5, expenses: [fixed(), subscription()] })
    expect(dates(d, ym(2026, 10))).toEqual(['Luz@2026-10-05', 'Streaming@2026-10-05'])
  })

  it('falls back to day 5 when the user has not configured one', () => {
    expect(EMPTY_DATA.defaultPaymentDay).toBe(5)
    expect(dates(data({ expenses: [fixed()] }), ym(2026, 10))).toEqual(['Luz@2026-10-05'])
  })

  it('an expense override takes precedence over the default', () => {
    const car = fixed({ id: 'car', name: 'Carro', paymentDayOverride: 17, category: 'OTHER' })
    const d = data({ defaultPaymentDay: 5, expenses: [car, fixed()] })
    expect(dates(d, ym(2026, 10))).toEqual(['Luz@2026-10-05', 'Carro@2026-10-17'])
    expect(effectivePaymentDay({ paymentDayOverride: 17 }, 5)).toBe(17)
    expect(effectivePaymentDay({ paymentDayOverride: null }, 5)).toBe(5)
  })

  it('changing the default moves only expenses without override', () => {
    const car = fixed({ id: 'car', name: 'Carro', paymentDayOverride: 17 })
    const d = data({ defaultPaymentDay: 10, expenses: [car, fixed()] })
    expect(dates(d, ym(2026, 10))).toEqual(['Luz@2026-10-10', 'Carro@2026-10-17'])
  })

  it('the payment day decides whether the start month counts', () => {
    // Starts Oct 10: paid on day 5 → first payment Nov 5; paid on day 17 → Oct 17.
    const onDefault = fixed({ startDate: '2026-10-10' })
    const withOverride = fixed({ id: 'o', startDate: '2026-10-10', paymentDayOverride: 17 })
    expect(projectMonth(data({ defaultPaymentDay: 5, expenses: [onDefault] }), ym(2026, 10)).expenses.fixed).toBe(0)
    expect(projectMonth(data({ defaultPaymentDay: 5, expenses: [onDefault] }), ym(2026, 11)).expenses.fixed).toBe(200)
    expect(projectMonth(data({ defaultPaymentDay: 5, expenses: [withOverride] }), ym(2026, 10)).expenses.fixed).toBe(200)
    expect(projectMonth(data({ defaultPaymentDay: 12, expenses: [onDefault] }), ym(2026, 10)).expenses.fixed).toBe(200)
  })

  it('clamps payment days to the month length', () => {
    const d = data({ defaultPaymentDay: 31, expenses: [fixed()] })
    expect(dates(d, ym(2027, 2))).toEqual(['Luz@2027-02-28'])
    expect(dates(d, ym(2028, 2))).toEqual(['Luz@2028-02-29'])
    expect(dates(d, ym(2026, 4))).toEqual(['Luz@2026-04-30'])
  })

  it('annual expenses combine their month with the effective payment day', () => {
    const ipva = fixed({ name: 'IPVA', recurrence: 'ANNUAL', chargeMonth: 1, category: 'TAX' })
    expect(dates(data({ defaultPaymentDay: 5, expenses: [ipva] }), ym(2027, 1))).toEqual(['IPVA@2027-01-05'])
    expect(dates(data({ defaultPaymentDay: 5, expenses: [{ ...ipva, paymentDayOverride: 20 } as Expense] }), ym(2027, 1))).toEqual(['IPVA@2027-01-20'])
  })

  it('never affects credit card statements', () => {
    const lateCard: CreditCard = { id: 'c3', nickname: 'Vence 25', dueDay: 25, closingDaysBefore: 7 }
    const expenses: Expense[] = [
      { id: 'a', type: 'OCCASIONAL', name: 'Roupa', amount: 100, purchaseDate: '2026-10-20', paymentMethod: 'CREDIT_CARD', cardId: 'c1' },
      { id: 'b', type: 'OCCASIONAL', name: 'Livro', amount: 50, purchaseDate: '2026-10-10', paymentMethod: 'CREDIT_CARD', cardId: 'c3' },
      { id: 'c', type: 'INSTALLMENT', name: 'TV', installmentAmount: 200, installmentsCount: 3, purchaseDate: '2026-10-30', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null },
    ]
    const run = (defaultPaymentDay: number) =>
      projectMonths(data({ defaultPaymentDay, cards: [card, lateCard], expenses }), ym(2026, 10), 5).map((m) => m.expenses.items)
    expect(run(1)).toEqual(run(28))
    const [oct, nov, dec] = run(17)
    expect(oct.map((i) => `${i.name}@${i.date}`)).toEqual(['Livro@2026-10-25'])
    expect(nov.map((i) => `${i.name}@${i.date}`)).toEqual(['Roupa@2026-11-05'])
    expect(dec.map((i) => `${i.name}@${i.date}`)).toEqual(['TV@2026-12-05'])
  })

  it('never affects Cash/Pix purchases or non-card installments', () => {
    const expenses: Expense[] = [
      { id: 'p', type: 'OCCASIONAL', name: 'Mercado', amount: 300, purchaseDate: '2026-10-12', paymentMethod: 'PIX', cardId: null },
      { id: 'i', type: 'INSTALLMENT', name: 'Curso', installmentAmount: 100, installmentsCount: 2, purchaseDate: '2026-10-01', paymentMethod: 'PIX', cardId: null, firstPaymentDate: '2026-10-22' },
    ]
    const run = (defaultPaymentDay: number) => projectMonths(data({ defaultPaymentDay, expenses }), ym(2026, 10), 2).map((m) => m.expenses.items)
    expect(run(1)).toEqual(run(28))
    expect(run(5)[0].map((i) => `${i.name}@${i.date}`)).toEqual(['Mercado@2026-10-12', 'Curso@2026-10-22'])
    expect(run(5)[1].map((i) => `${i.name}@${i.date}`)).toEqual(['Curso@2026-11-22'])
  })

  it('lists a month by payment date, mixing defaults, overrides and card due dates', () => {
    const d = data({
      defaultPaymentDay: 10,
      cards: [card],
      expenses: [
        fixed({ id: 'car', name: 'Carro', paymentDayOverride: 17 }),
        fixed(),
        { id: 'r', type: 'OCCASIONAL', name: 'Roupa', amount: 100, purchaseDate: '2026-10-20', paymentMethod: 'CREDIT_CARD', cardId: 'c1' },
      ],
    })
    expect(dates(d, ym(2026, 11))).toEqual(['Roupa@2026-11-05', 'Luz@2026-11-10', 'Carro@2026-11-17'])
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

describe('credit card projection', () => {
  const lateCard: CreditCard = { id: 'c3', nickname: 'Vence 25', dueDay: 25, closingDaysBefore: 7 }
  const occasional = (id: string, purchaseDate: string, cardId: string): Expense => ({
    id, type: 'OCCASIONAL', name: id, amount: 100, purchaseDate, paymentMethod: 'CREDIT_CARD', cardId,
  })

  it('counts a same-month statement in the purchase month', () => {
    const d = data({
      cards: [card, lateCard],
      expenses: [occasional('a', '2026-10-01', 'c1'), occasional('b', '2026-10-10', 'c3'), occasional('c', '2026-10-31', 'c3')],
    })
    const p = projectMonths(d, ym(2026, 10), 3)
    expect(p.map((m) => m.expenses.occasional)).toEqual([100, 200, 0])
    expect(p[0].expenses.items[0]).toMatchObject({ name: 'b', date: '2026-10-25', cardName: 'Vence 25' })
  })

  it('counts before-closing, closing-day and after-closing purchases in the right statement', () => {
    const d = data({
      cards: [card],
      expenses: [occasional('before', '2026-10-28', 'c1'), occasional('closing', '2026-10-29', 'c1'), occasional('after', '2026-10-30', 'c1')],
    })
    const [oct, nov, dec] = projectMonths(d, ym(2026, 10), 3)
    expect(oct.expenses.items).toEqual([])
    expect(nov.expenses.items.map((i) => i.name)).toEqual(['before'])
    expect(dec.expenses.items.map((i) => i.name)).toEqual(['closing', 'after'])
  })

  it('crosses the year boundary', () => {
    const d = data({ cards: [card, lateCard], expenses: [occasional('a', '2026-12-28', 'c1'), occasional('b', '2026-12-29', 'c1'), occasional('c', '2026-12-18', 'c3')] })
    const [dec, jan, feb] = projectMonths(d, ym(2026, 12), 3)
    expect(dec.expenses.items).toEqual([])
    expect(jan.expenses.items.map((i) => `${i.name}@${i.date}`)).toEqual(['a@2027-01-05', 'c@2027-01-25'])
    expect(feb.expenses.items.map((i) => `${i.name}@${i.date}`)).toEqual(['b@2027-02-05'])
  })

  it('falls back to the purchase month when the card is unknown', () => {
    const d = data({ expenses: [occasional('x', '2026-10-10', 'missing')] })
    expect(projectMonths(d, ym(2026, 10), 2).map((m) => m.expenses.occasional)).toEqual([100, 0])
  })

  it('assigns installments to consecutive statements across the year boundary', () => {
    const tv: Expense = {
      id: 't', type: 'INSTALLMENT', name: 'TV', installmentAmount: 250, installmentsCount: 4,
      purchaseDate: '2026-11-29', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null,
    }
    // Nov 29 is after the Dec 5 statement closed (Nov 28) → Jan, Feb, Mar, Apr 2027
    const p = projectMonths(data({ cards: [card], expenses: [tv] }), ym(2026, 11), 7)
    expect(p.map((m) => m.expenses.installments)).toEqual([0, 0, 250, 250, 250, 250, 0])
    expect(p.slice(2, 6).map((m) => m.expenses.items[0].installmentLabel)).toEqual(['1/4', '2/4', '3/4', '4/4'])
    expect(p.slice(2, 6).map((m) => m.expenses.items[0].date)).toEqual(['2027-01-05', '2027-02-05', '2027-03-05', '2027-04-05'])
  })

  it('installments on a same-month statement start in the purchase month', () => {
    const sofa = (purchaseDate: string): Expense => ({
      id: 'l', type: 'INSTALLMENT', name: 'Sofá', installmentAmount: 300, installmentsCount: 3,
      purchaseDate, paymentMethod: 'CREDIT_CARD', cardId: 'c3', firstPaymentDate: null,
    })
    const run = (date: string) => projectMonths(data({ cards: [lateCard], expenses: [sofa(date)] }), ym(2026, 12), 5).map((m) => m.expenses.installments)
    expect(run('2026-12-10')).toEqual([300, 300, 300, 0, 0]) // Dec, Jan, Feb
    expect(run('2026-12-18')).toEqual([0, 300, 300, 300, 0]) // closing day → Jan, Feb, Mar
  })

  it('ignores firstPaymentDate for card installments', () => {
    const e: Expense = {
      id: 'f', type: 'INSTALLMENT', name: 'X', installmentAmount: 100, installmentsCount: 2,
      purchaseDate: '2026-10-10', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: '2026-10-10',
    }
    expect(projectMonths(data({ cards: [card], expenses: [e] }), ym(2026, 10), 3).map((m) => m.expenses.installments)).toEqual([0, 100, 100])
  })
})

describe('occasional expenses', () => {
  it('cash/pix count in the purchase month; card in the statement month', () => {
    const expenses: Expense[] = [
      { id: 'o1', type: 'OCCASIONAL', name: 'Mercado', amount: 300, purchaseDate: '2026-10-10', paymentMethod: 'PIX', cardId: null },
      { id: 'o3', type: 'OCCASIONAL', name: 'Feira', amount: 50, purchaseDate: '2026-12-31', paymentMethod: 'CASH', cardId: null },
      { id: 'o2', type: 'OCCASIONAL', name: 'Farmácia', amount: 80, purchaseDate: '2026-10-30', paymentMethod: 'CREDIT_CARD', cardId: 'c1' },
    ]
    const p = projectMonths(data({ cards: [card], expenses }), ym(2026, 10), 4)
    expect(p.map((m) => m.expenses.occasional)).toEqual([300, 0, 130, 0])
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

  it('places a single card payment in the statement month, not the current month', () => {
    const r = simulatePurchase(base(), { amount: 400, paymentMethod: 'CREDIT_CARD', cardId: 'c1', installments: 1, purchaseDate: '2026-10-29' }, ym(2026, 10))
    expect(r.rows.map((x) => x.balanceDifference)).toEqual([0, 0, -400])
  })

  it('uses the same billing rules as the dashboard projection', () => {
    for (const purchaseDate of ['2026-10-01', '2026-10-28', '2026-10-29', '2026-10-31', '2026-12-29']) {
      const input = { amount: 1200, paymentMethod: 'CREDIT_CARD' as const, cardId: 'c1', installments: 4, purchaseDate }
      const sim = simulatePurchase(base(), input, ym(2026, 10))
      const persisted = data({ ...base(), expenses: [...base().expenses, { ...simulationToExpense(input), id: 'p' }] })
      expect(projectMonths(persisted, ym(2026, 10), sim.rows.length)).toEqual(sim.rows.map((r) => ({
        ...r.after,
        expenses: { ...r.after.expenses, items: r.after.expenses.items.map((i) => (i.expenseId === '__simulation__' ? { ...i, expenseId: 'p' } : i)) },
      })))
    }
  })

  it('a card purchase on a same-month statement affects the current month', () => {
    const lateCard: CreditCard = { id: 'c3', nickname: 'Vence 25', dueDay: 25, closingDaysBefore: 7 }
    const d = { ...base(), cards: [card, lateCard] }
    const before = simulatePurchase(d, { amount: 300, paymentMethod: 'CREDIT_CARD', cardId: 'c3', installments: 3, purchaseDate: '2026-10-10' }, ym(2026, 10))
    expect(before.rows.map((x) => x.balanceDifference)).toEqual([-100, -100, -100])
    const onClosing = simulatePurchase(d, { amount: 300, paymentMethod: 'CREDIT_CARD', cardId: 'c3', installments: 3, purchaseDate: '2026-10-18' }, ym(2026, 10))
    expect(onClosing.rows.map((x) => x.balanceDifference)).toEqual([0, -100, -100, -100])
  })

  it('"before" matches the dashboard projection, including payment-day rules', () => {
    const d = data({
      fixedSalary: 7000,
      defaultPaymentDay: 20,
      cards: [card],
      expenses: [fixed({ startDate: '2026-10-10' }), fixed({ id: 'car', name: 'Carro', startDate: '2026-10-10', paymentDayOverride: 3 })],
    })
    const sim = simulatePurchase(d, { amount: 90, paymentMethod: 'PIX', installments: 1, purchaseDate: '2026-10-18' }, ym(2026, 10))
    expect(sim.rows.map((r) => r.before)).toEqual(projectMonths(d, ym(2026, 10), sim.rows.length))
    // Luz (day 20) counts from October, Carro (day 3) only from November.
    expect(sim.rows.map((r) => r.before.expenses.fixed)).toEqual([200, 400, 400])
    expect(sim.rows.map((r) => r.balanceDifference)).toEqual([-90, 0, 0])
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
