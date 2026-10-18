// Conversion between database rows (snake_case, numeric as string) and domain objects.
import type { CreditCard, Expense, IncomeSource, NewExpense, SalaryEntry } from '../domain/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export const salaryFromRow = (r: Row): SalaryEntry => ({
  id: r.id,
  referenceMonth: r.reference_month,
  netAmount: Number(r.net_amount),
  receiptDate: r.receipt_date,
})

export const salaryToRow = (e: Omit<SalaryEntry, 'id'>): Row => ({
  reference_month: e.referenceMonth,
  net_amount: e.netAmount,
  receipt_date: e.receiptDate,
})

export const incomeFromRow = (r: Row): IncomeSource => ({
  id: r.id,
  name: r.name,
  amount: Number(r.amount),
  type: r.type,
  recurrence: r.recurrence,
  expectedDate: r.expected_date,
})

export const incomeToRow = (s: Omit<IncomeSource, 'id'>): Row => ({
  name: s.name,
  amount: s.amount,
  type: s.type,
  recurrence: s.recurrence,
  expected_date: s.expectedDate,
})

export const cardFromRow = (r: Row): CreditCard => ({
  id: r.id,
  nickname: r.nickname,
  dueDay: r.due_day,
  closingDaysBefore: r.closing_days_before,
})

export const cardToRow = (c: Omit<CreditCard, 'id'>): Row => ({
  nickname: c.nickname,
  due_day: c.dueDay,
  closing_days_before: c.closingDaysBefore,
})

export function expenseFromRow(r: Row): Expense {
  const base = { id: r.id as string, name: r.name as string }
  switch (r.type) {
    case 'FIXED':
    case 'SUBSCRIPTION': {
      const recurring = {
        amount: Number(r.amount),
        recurrence: r.recurrence,
        chargeDay: r.charge_day,
        chargeMonth: num(r.charge_month),
        startDate: r.start_date,
      }
      return r.type === 'FIXED'
        ? { ...base, ...recurring, type: 'FIXED', category: r.category }
        : { ...base, ...recurring, type: 'SUBSCRIPTION' }
    }
    case 'INSTALLMENT':
      return {
        ...base,
        type: 'INSTALLMENT',
        installmentAmount: Number(r.amount),
        installmentsCount: r.installments_count,
        purchaseDate: r.purchase_date,
        paymentMethod: r.payment_method,
        cardId: r.card_id,
        firstPaymentDate: r.first_payment_date,
      }
    default:
      return {
        ...base,
        type: 'OCCASIONAL',
        amount: Number(r.amount),
        purchaseDate: r.purchase_date,
        paymentMethod: r.payment_method,
        cardId: r.card_id,
      }
  }
}

/** Full row, with unused type-specific columns explicitly nulled (so edits that change type stay consistent). */
export function expenseToRow(e: NewExpense): Row {
  const empty: Row = {
    recurrence: null, category: null, charge_day: null, charge_month: null, start_date: null,
    installments_count: null, first_payment_date: null, purchase_date: null, payment_method: null, card_id: null,
  }
  const common = { ...empty, type: e.type, name: e.name }
  switch (e.type) {
    case 'FIXED':
    case 'SUBSCRIPTION':
      return {
        ...common,
        amount: e.amount,
        recurrence: e.recurrence,
        category: e.type === 'FIXED' ? e.category : null,
        charge_day: e.chargeDay,
        charge_month: e.recurrence === 'ANNUAL' ? e.chargeMonth : null,
        start_date: e.startDate,
      }
    case 'INSTALLMENT': {
      const isCard = e.paymentMethod === 'CREDIT_CARD'
      return {
        ...common,
        amount: e.installmentAmount,
        installments_count: e.installmentsCount,
        purchase_date: e.purchaseDate,
        payment_method: e.paymentMethod,
        card_id: isCard ? e.cardId : null,
        first_payment_date: isCard ? null : e.firstPaymentDate,
      }
    }
    case 'OCCASIONAL':
      return {
        ...common,
        amount: e.amount,
        purchase_date: e.purchaseDate,
        payment_method: e.paymentMethod,
        card_id: e.paymentMethod === 'CREDIT_CARD' ? e.cardId : null,
      }
  }
}
