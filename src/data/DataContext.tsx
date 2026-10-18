import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CreditCard, FinancialData, IncomeSource, NewExpense, SalaryEntry } from '../domain/types'
import {
  cardFromRow,
  cardToRow,
  expenseFromRow,
  expenseToRow,
  incomeFromRow,
  incomeToRow,
  salaryFromRow,
  salaryToRow,
  type Row,
} from './mappers'
import { requireSupabase } from './supabase'

type Table = 'salary_history' | 'income_sources' | 'credit_cards' | 'expenses'

interface DataState {
  data: FinancialData | null
  error: string | null
  reload(): Promise<void>
  saveFixedSalary(value: number | null): Promise<void>
  saveSalaryEntry(entry: Omit<SalaryEntry, 'id'>, id?: string): Promise<void>
  saveIncomeSource(source: Omit<IncomeSource, 'id'>, id?: string): Promise<void>
  saveCard(card: Omit<CreditCard, 'id'>, id?: string): Promise<void>
  saveExpense(expense: NewExpense, id?: string): Promise<void>
  remove(table: Table, id: string): Promise<void>
}

const DataContext = createContext<DataState | null>(null)

/** Translates common database errors into friendly messages. */
function friendlyError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('Já existe um registro para este período.')
  if (error.code === '23503') return new Error('Este cartão está sendo usado por despesas. Altere ou remova essas despesas antes.')
  if (error.code === '23514') return new Error('Alguns dados são inválidos. Verifique os campos.')
  return new Error(error.message)
}

async function check<T extends { error: { code?: string; message: string } | null }>(p: PromiseLike<T>): Promise<T> {
  const result = await p
  if (result.error) throw friendlyError(result.error)
  return result
}

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [data, setData] = useState<FinancialData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const sb = requireSupabase()
    try {
      const [profile, salary, income, cards, expenses] = await Promise.all([
        check(sb.from('profiles').select('fixed_salary').maybeSingle()),
        check(sb.from('salary_history').select('*').order('reference_month', { ascending: false })),
        check(sb.from('income_sources').select('*').order('name')),
        check(sb.from('credit_cards').select('*').order('nickname')),
        check(sb.from('expenses').select('*').order('created_at', { ascending: false })),
      ])
      const fixed = (profile.data as Row | null)?.fixed_salary
      setData({
        fixedSalary: fixed === null || fixed === undefined ? null : Number(fixed),
        salaryHistory: (salary.data ?? []).map(salaryFromRow),
        incomeSources: (income.data ?? []).map(incomeFromRow),
        cards: (cards.data ?? []).map(cardFromRow),
        expenses: (expenses.data ?? []).map(expenseFromRow),
      })
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    setData(null)
    reload()
  }, [userId, reload])

  const save = useCallback(
    async (table: Table, row: Row, id?: string) => {
      const sb = requireSupabase()
      await check(id ? sb.from(table).update(row).eq('id', id) : sb.from(table).insert(row))
      await reload()
    },
    [reload],
  )

  const value: DataState = {
    data,
    error,
    reload,
    async saveFixedSalary(value) {
      await check(requireSupabase().from('profiles').upsert({ user_id: userId, fixed_salary: value, updated_at: new Date().toISOString() }))
      await reload()
    },
    saveSalaryEntry: (entry, id) => save('salary_history', salaryToRow(entry), id),
    saveIncomeSource: (source, id) => save('income_sources', incomeToRow(source), id),
    saveCard: (card, id) => save('credit_cards', cardToRow(card), id),
    saveExpense: (expense, id) => save('expenses', expenseToRow(expense), id),
    async remove(table, id) {
      await check(requireSupabase().from(table).delete().eq('id', id))
      await reload()
    },
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataState {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used inside DataProvider')
  return ctx
}

/** Financial data, guaranteed loaded (pages render only after loading). */
export function useFinancialData(): FinancialData {
  const { data } = useData()
  if (!data) throw new Error('Data not loaded')
  return data
}
