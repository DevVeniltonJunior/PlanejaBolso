import { describe, expect, it } from 'vitest'
import type { NewExpense } from '../domain/types'
import { closedCycleFromRow, cycleToColumn, expenseFromRow, expenseToRow } from './mappers'

const row = {
  id: 'x', type: 'INSTALLMENT', name: 'Carnê', amount: '150.00', installments_count: 6, purchase_date: '2026-09-15',
  payment_method: 'PIX', card_id: null, first_payment_date: '2026-10-15', payment_day_override: null,
  recurrence: null, category: null, charge_month: null, start_date: null,
}

describe('expense mappers', () => {
  it('reads Pix installments saved before the due day existed', () => {
    expect(expenseFromRow(row)).toEqual({
      id: 'x', type: 'INSTALLMENT', name: 'Carnê', installmentAmount: 150, installmentsCount: 6, purchaseDate: '2026-09-15',
      paymentMethod: 'PIX', cardId: null, firstPaymentDate: '2026-10-15', dueDay: null,
    })
  })

  it('stores the Pix/Cash due day; card installments keep it empty', () => {
    const pix: NewExpense = {
      type: 'INSTALLMENT', name: 'Carro', installmentAmount: 850, installmentsCount: 24, purchaseDate: '2026-11-10',
      paymentMethod: 'PIX', cardId: null, firstPaymentDate: '2026-11-10', dueDay: 10,
    }
    expect(expenseToRow(pix)).toMatchObject({ payment_day_override: 10, first_payment_date: '2026-11-10', card_id: null })
    expect(expenseFromRow({ ...expenseToRow(pix), id: 'p', amount: '850.00' })).toEqual({ ...pix, id: 'p' })

    const card: NewExpense = { ...pix, paymentMethod: 'CREDIT_CARD', cardId: 'c1', firstPaymentDate: '2026-11-10', dueDay: 10 }
    expect(expenseToRow(card)).toMatchObject({ payment_day_override: null, first_payment_date: null, card_id: 'c1' })
  })
})

describe('cycle mappers', () => {
  it('stores cycles as the first day of their month', () => {
    expect(cycleToColumn({ year: 2026, month: 12 })).toBe('2026-12-01')
    expect(closedCycleFromRow({ cycle_month: '2026-11-01', closed_at: '2026-11-01T12:00:00+00:00' })).toEqual({
      cycle: { year: 2026, month: 11 },
      closedAt: '2026-11-01T12:00:00+00:00',
    })
  })
})
