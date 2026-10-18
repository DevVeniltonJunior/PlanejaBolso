import { monthKey, monthOf, type YearMonth } from './dates'
import type { FinancialData, SalaryEntry } from './types'
import { roundMoney } from './money'

/** Number of latest months used for the average net salary. */
export const SALARY_AVERAGE_WINDOW = 6
/** Minimum history entries before the average replaces the fixed salary in projections. */
export const MIN_ENTRIES_FOR_AVERAGE = 3

export function latestSalaryEntries(history: SalaryEntry[], window = SALARY_AVERAGE_WINDOW): SalaryEntry[] {
  return [...history].sort((a, b) => b.referenceMonth.localeCompare(a.referenceMonth)).slice(0, window)
}

/** Average of the latest six net salaries (or all, if fewer). `null` when there is no history. */
export function averageNetSalary(history: SalaryEntry[]): number | null {
  const latest = latestSalaryEntries(history)
  if (latest.length === 0) return null
  return roundMoney(latest.reduce((sum, e) => sum + e.netAmount, 0) / latest.length)
}

export type SalarySource = 'ACTUAL' | 'AVERAGE' | 'FIXED' | 'NONE'

export interface SalaryProjection {
  amount: number
  source: SalarySource
}

/**
 * Salary expected for a month:
 * 1. the net salary actually recorded for that month, if any;
 * 2. otherwise the average net salary, once enough history exists
 *    (or whenever there is history but no fixed salary);
 * 3. otherwise the fixed salary.
 */
export function salaryForMonth(data: Pick<FinancialData, 'fixedSalary' | 'salaryHistory'>, ym: YearMonth): SalaryProjection {
  const key = monthKey(ym)
  const actual = data.salaryHistory.find((e) => monthKey(monthOf(e.referenceMonth)) === key)
  if (actual) return { amount: actual.netAmount, source: 'ACTUAL' }

  const average = averageNetSalary(data.salaryHistory)
  const enoughHistory = data.salaryHistory.length >= MIN_ENTRIES_FOR_AVERAGE
  if (average !== null && (enoughHistory || data.fixedSalary === null)) return { amount: average, source: 'AVERAGE' }

  if (data.fixedSalary !== null) return { amount: data.fixedSalary, source: 'FIXED' }
  return { amount: 0, source: 'NONE' }
}
