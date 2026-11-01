// Smoke tests: every page renders with realistic data without throwing.
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatBRL } from '../domain/format'
import type { FinancialData } from '../domain/types'

const base: FinancialData = {
  fixedSalary: 8000,
  defaultPaymentDay: 5,
  salaryHistory: [{ id: 's1', referenceMonth: '2026-09-01', netAmount: 6940, receiptDate: '2026-09-05' }],
  incomeSources: [{ id: 'i1', name: 'Aluguel', amount: 1800, type: 'RENT', recurrence: 'MONTHLY', expectedDate: '2026-01-10' }],
  cards: [{ id: 'c1', nickname: 'Final 42', dueDay: 5, closingDaysBefore: 7 }],
  expenses: [
    { id: 'e1', type: 'FIXED', name: 'Luz', amount: 250, recurrence: 'MONTHLY', category: 'BILL', paymentDayOverride: 17, chargeMonth: null, startDate: '2026-01-01' },
    { id: 'e2', type: 'SUBSCRIPTION', name: 'Streaming', amount: 39.9, recurrence: 'ANNUAL', paymentDayOverride: null, chargeMonth: 2, startDate: '2026-01-01' },
    { id: 'e3', type: 'INSTALLMENT', name: 'Notebook', installmentAmount: 500, installmentsCount: 10, purchaseDate: '2026-10-01', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null, dueDay: null },
    { id: 'e4', type: 'OCCASIONAL', name: 'Mercado', amount: 320.5, purchaseDate: '2026-10-12', paymentMethod: 'PIX', cardId: null },
    { id: 'e5', type: 'INSTALLMENT', name: 'Financiamento do carro', installmentAmount: 850, installmentsCount: 24, purchaseDate: '2026-11-10', paymentMethod: 'PIX', cardId: null, firstPaymentDate: '2026-11-10', dueDay: 10 },
    // Due on the payment day (05/11): it closes the October cycle.
    { id: 'e6', type: 'FIXED', name: 'Aluguel do apê', amount: 1500, recurrence: 'MONTHLY', category: 'BILL', paymentDayOverride: null, chargeMonth: null, startDate: '2026-01-01' },
  ],
  activeCycle: null,
  closedCycles: [],
}

let sample = base
const closeCycle = vi.fn()

vi.mock('../data/DataContext', () => ({
  useFinancialData: () => sample,
  useData: () => ({ data: sample, error: null, closeCycle }),
}))

const { DashboardPage } = await import('./Dashboard')
const { ExpensesPage } = await import('./Expenses')
const { IncomePage } = await import('./Income')
const { CardsPage } = await import('./Cards')
const { SimulatorPage } = await import('./Simulator')

// Drops the separators React inserts between adjacent text nodes.
const render = (el: React.ReactElement, url = '/') =>
  renderToString(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>).replaceAll('<!-- -->', '')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 9)) // 01/11/2026, local time
})
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  sample = base
  closeCycle.mockClear()
})

describe('pages', () => {
  it('render without errors', () => {
    expect(render(<DashboardPage />)).toContain('Simular compra')
    expect(render(<ExpensesPage />)).toContain('Notebook')
    expect(render(<IncomePage />)).toContain('Aluguel')
    expect(render(<CardsPage />)).toContain('Final 42')
    expect(render(<SimulatorPage />)).toContain('Valor da compra')
  })
})

describe('dashboard financial cycle', () => {
  it('opens on the calendar month (November) even with expenses still due in the October cycle', () => {
    const html = render(<DashboardPage />)
    expect(html).toContain('Ciclo de novembro de 2026')
    expect(html).toContain('Ciclo atual')
    expect(html).toContain('Encerrar ciclo')
    expect(html).not.toContain('Voltar ao ciclo atual')
    expect(html).toContain('← out/2026')
    expect(html).toContain('dez/2026 →')
  })

  it('navigates to previous and next cycles without offering to close them', () => {
    for (const [url, title, label] of [
      ['/?ciclo=2026-10', 'Ciclo de outubro de 2026', 'Ciclo anterior'],
      ['/?ciclo=2026-12', 'Ciclo de dezembro de 2026', 'Ciclo futuro'],
    ]) {
      const html = render(<DashboardPage />, url)
      expect(html).toContain(title)
      expect(html).toContain(label)
      expect(html).toContain('Voltar ao ciclo atual')
      expect(html).not.toContain('Encerrar ciclo')
    }
    expect(render(<DashboardPage />, '/?ciclo=2026-11')).toContain('Encerrar ciclo')
    expect(render(<DashboardPage />, '/?ciclo=lixo')).toContain('Ciclo de novembro de 2026')
  })

  it('shows the indicators of the selected cycle', () => {
    const installments = (url: string) => /Parcelas<\/span><strong>([^<]+)</.exec(render(<DashboardPage />, url))?.[1]
    // Notebook (card statement due 05/11) is paid by October; the Pix car financing starts in November.
    expect(installments('/?ciclo=2026-10')).toBe(formatBRL(500))
    expect(installments('/?ciclo=2026-11')).toBe(formatBRL(1350))
  })

  it('keeps the persisted active cycle after a reload, even ahead of the calendar', () => {
    sample = { ...base, activeCycle: { year: 2026, month: 12 }, closedCycles: [{ cycle: { year: 2026, month: 11 }, closedAt: '2026-11-01T12:00:00Z' }] }
    const html = render(<DashboardPage />)
    expect(html).toContain('Ciclo de dezembro de 2026')
    expect(html).toContain('Encerrar ciclo')
  })

  it('shows a closed cycle as history without changing the active cycle', () => {
    sample = { ...base, activeCycle: { year: 2026, month: 12 }, closedCycles: [{ cycle: { year: 2026, month: 11 }, closedAt: '2026-11-01T12:00:00Z' }] }
    const html = render(<DashboardPage />, '/?ciclo=2026-11')
    expect(html).toContain('Ciclo de novembro de 2026')
    expect(html).toContain('Encerrado em 01/11/2026')
    expect(html).not.toContain('Encerrar ciclo')
    expect(html).toContain('Voltar ao ciclo atual')
    expect(closeCycle).not.toHaveBeenCalled()
  })
})
