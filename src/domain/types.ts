/** ISO calendar date, `YYYY-MM-DD`. Kept as a string to avoid timezone drift. */
export type ISODate = string

export type Recurrence = 'MONTHLY' | 'ANNUAL'
export type IncomeRecurrence = 'MONTHLY' | 'ANNUAL' | 'OCCASIONAL'
export type IncomeType = 'RENT' | 'FREELANCE' | 'INVESTMENT' | 'OTHER'
export type PaymentMethod = 'CASH' | 'PIX' | 'CREDIT_CARD'
export type ExpenseType = 'FIXED' | 'INSTALLMENT' | 'SUBSCRIPTION' | 'OCCASIONAL'
export type FixedCategory = 'BILL' | 'TAX' | 'OTHER'

export interface SalaryEntry {
  id: string
  /** First day of the reference month (`YYYY-MM-01`). */
  referenceMonth: ISODate
  netAmount: number
  receiptDate: ISODate | null
}

export interface IncomeSource {
  id: string
  name: string
  amount: number
  type: IncomeType
  recurrence: IncomeRecurrence
  /**
   * MONTHLY: first expected receipt (day of month is used from then on).
   * ANNUAL: first expected receipt (month + day repeat yearly).
   * OCCASIONAL: the single expected receipt date.
   */
  expectedDate: ISODate
}

export interface CreditCard {
  id: string
  nickname: string
  /** Day of month the statement is due (1–31, clamped to month length). */
  dueDay: number
  /** Days between statement closing and due date. */
  closingDaysBefore: number
}

interface RecurringFields {
  amount: number
  recurrence: Recurrence
  /** Day of month the charge is expected. */
  chargeDay: number
  /** Month (1–12) of the charge; only for ANNUAL recurrence. */
  chargeMonth: number | null
  startDate: ISODate
}

export interface FixedExpense extends RecurringFields {
  id: string
  type: 'FIXED'
  name: string
  category: FixedCategory
}

export interface SubscriptionExpense extends RecurringFields {
  id: string
  type: 'SUBSCRIPTION'
  name: string
}

export interface InstallmentExpense {
  id: string
  type: 'INSTALLMENT'
  name: string
  installmentAmount: number
  installmentsCount: number
  purchaseDate: ISODate
  paymentMethod: PaymentMethod
  cardId: string | null
  /** Required when the payment method is not a credit card. */
  firstPaymentDate: ISODate | null
}

export interface OccasionalExpense {
  id: string
  type: 'OCCASIONAL'
  name: string
  amount: number
  purchaseDate: ISODate
  paymentMethod: PaymentMethod
  cardId: string | null
}

export type Expense = FixedExpense | SubscriptionExpense | InstallmentExpense | OccasionalExpense

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
export type NewExpense = DistributiveOmit<Expense, 'id'>

export interface FinancialData {
  fixedSalary: number | null
  salaryHistory: SalaryEntry[]
  incomeSources: IncomeSource[]
  cards: CreditCard[]
  expenses: Expense[]
}

export const EMPTY_DATA: FinancialData = {
  fixedSalary: null,
  salaryHistory: [],
  incomeSources: [],
  cards: [],
  expenses: [],
}
