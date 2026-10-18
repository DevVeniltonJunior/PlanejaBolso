// Smoke tests: every page renders with realistic data without throwing.
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { FinancialData } from '../domain/types'

const sample: FinancialData = {
  fixedSalary: 8000,
  salaryHistory: [{ id: 's1', referenceMonth: '2026-09-01', netAmount: 6940, receiptDate: '2026-09-05' }],
  incomeSources: [{ id: 'i1', name: 'Aluguel', amount: 1800, type: 'RENT', recurrence: 'MONTHLY', expectedDate: '2026-01-10' }],
  cards: [{ id: 'c1', nickname: 'Final 42', dueDay: 5, closingDaysBefore: 7 }],
  expenses: [
    { id: 'e1', type: 'FIXED', name: 'Luz', amount: 250, recurrence: 'MONTHLY', category: 'BILL', chargeDay: 10, chargeMonth: null, startDate: '2026-01-01' },
    { id: 'e2', type: 'SUBSCRIPTION', name: 'Streaming', amount: 39.9, recurrence: 'ANNUAL', chargeDay: 3, chargeMonth: 2, startDate: '2026-01-01' },
    { id: 'e3', type: 'INSTALLMENT', name: 'Notebook', installmentAmount: 500, installmentsCount: 10, purchaseDate: '2026-10-01', paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: null },
    { id: 'e4', type: 'OCCASIONAL', name: 'Mercado', amount: 320.5, purchaseDate: '2026-10-12', paymentMethod: 'PIX', cardId: null },
  ],
}

vi.mock('../data/DataContext', () => ({
  useFinancialData: () => sample,
  useData: () => ({ data: sample, error: null }),
}))

const { DashboardPage } = await import('./Dashboard')
const { ExpensesPage } = await import('./Expenses')
const { IncomePage } = await import('./Income')
const { CardsPage } = await import('./Cards')
const { SimulatorPage } = await import('./Simulator')

const render = (el: React.ReactElement, url = '/') => renderToString(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>)

describe('pages', () => {
  it('render without errors', () => {
    expect(render(<DashboardPage />)).toContain('Simular compra')
    expect(render(<ExpensesPage />)).toContain('Notebook')
    expect(render(<IncomePage />)).toContain('Aluguel')
    expect(render(<CardsPage />)).toContain('Final 42')
    expect(render(<SimulatorPage />)).toContain('Valor da compra')
  })
})
