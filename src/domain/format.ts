import { parseISODate, type YearMonth } from './dates'
import type { ExpenseType, FixedCategory, IncomeRecurrence, IncomeType, PaymentMethod, Recurrence } from './types'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export const formatBRL = (value: number) => brl.format(value)

export const formatPercent = (value: number | null) => (value === null ? '—' : `${pct.format(value)}%`)

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const monthName = (month: number) => MONTHS[month - 1]

/** "out/2026" */
export const formatMonthShort = (ym: YearMonth) => `${MONTHS[ym.month - 1].slice(0, 3)}/${ym.year}`

/** "Outubro de 2026" */
export const formatMonthLong = (ym: YearMonth) => {
  const name = MONTHS[ym.month - 1]
  return `${name[0].toUpperCase()}${name.slice(1)} de ${ym.year}`
}

/** "05/11/2026" */
export const formatDate = (iso: string) => {
  const d = parseISODate(iso)
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`
}

export const formatDayMonth = (d: { day: number; month: number }) =>
  `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}`

/** Value for a text money input, e.g. 1250.5 → "1250,50". */
export const moneyInputValue = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : value.toFixed(2).replace('.', ',')

export const EXPENSE_TYPE_LABEL: Record<ExpenseType, string> = {
  FIXED: 'Fixa',
  INSTALLMENT: 'Parcelada',
  SUBSCRIPTION: 'Assinatura',
  OCCASIONAL: 'Avulsa',
}

export const EXPENSE_TYPE_PLURAL: Record<ExpenseType, string> = {
  FIXED: 'Fixas',
  INSTALLMENT: 'Parcelas',
  SUBSCRIPTION: 'Assinaturas',
  OCCASIONAL: 'Avulsas',
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = { MONTHLY: 'Mensal', ANNUAL: 'Anual' }

export const INCOME_RECURRENCE_LABEL: Record<IncomeRecurrence, string> = {
  MONTHLY: 'Mensal',
  ANNUAL: 'Anual',
  OCCASIONAL: 'Eventual',
}

export const INCOME_TYPE_LABEL: Record<IncomeType, string> = {
  RENT: 'Aluguel',
  FREELANCE: 'Freelance',
  INVESTMENT: 'Investimentos',
  OTHER: 'Outros',
}

export const CATEGORY_LABEL: Record<FixedCategory, string> = { BILL: 'Conta', TAX: 'Imposto', OTHER: 'Outros' }

export const PAYMENT_LABEL: Record<PaymentMethod, string> = { CASH: 'Dinheiro', PIX: 'Pix', CREDIT_CARD: 'Cartão de crédito' }
