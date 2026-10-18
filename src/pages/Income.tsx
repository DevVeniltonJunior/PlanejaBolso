import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorMessage, Field, Modal, Money, confirmDelete, useAction } from '../components/ui'
import { useData, useFinancialData } from '../data/DataContext'
import { addMonths, currentMonth, monthKey, monthOf, parseISODate, todayISO } from '../domain/dates'
import {
  INCOME_RECURRENCE_LABEL,
  INCOME_TYPE_LABEL,
  formatBRL,
  formatDate,
  formatDayMonth,
  formatMonthShort,
  moneyInputValue,
} from '../domain/format'
import { parseMoney } from '../domain/money'
import { MIN_ENTRIES_FOR_AVERAGE, SALARY_AVERAGE_WINDOW, averageNetSalary, latestSalaryEntries, salaryForMonth } from '../domain/salary'
import type { IncomeRecurrence, IncomeSource, IncomeType, SalaryEntry } from '../domain/types'

export function IncomePage() {
  const [params, setParams] = useSearchParams()
  const [editingSource, setEditingSource] = useState<IncomeSource | 'new' | null>(params.get('novo') ? 'new' : null)
  const [editingSalary, setEditingSalary] = useState<SalaryEntry | 'new' | null>(null)

  return (
    <div className="page">
      <h1>Renda</h1>
      <FixedSalaryCard />
      <SalaryHistoryCard onEdit={setEditingSalary} />
      <IncomeSourcesCard onEdit={setEditingSource} />

      {editingSalary && (
        <Modal title={editingSalary === 'new' ? 'Registrar salário do mês' : 'Editar salário do mês'} onClose={() => setEditingSalary(null)}>
          <SalaryEntryForm entry={editingSalary === 'new' ? undefined : editingSalary} onDone={() => setEditingSalary(null)} />
        </Modal>
      )}
      {editingSource && (
        <Modal
          title={editingSource === 'new' ? 'Nova fonte de renda' : 'Editar fonte de renda'}
          onClose={() => {
            setEditingSource(null)
            if (params.has('novo')) setParams({}, { replace: true })
          }}
        >
          <IncomeSourceForm
            source={editingSource === 'new' ? undefined : editingSource}
            onDone={() => {
              setEditingSource(null)
              if (params.has('novo')) setParams({}, { replace: true })
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function FixedSalaryCard() {
  const data = useFinancialData()
  const { saveFixedSalary } = useData()
  const [value, setValue] = useState(moneyInputValue(data.fixedSalary))
  const [saved, setSaved] = useState(false)
  const action = useAction()
  const projected = salaryForMonth(data, addMonths(currentMonth(), 1))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = value.trim() ? parseMoney(value) : null
    if (value.trim() && (parsed === null || parsed < 0)) return action.setError('Informe um valor válido.')
    setSaved(await action.run(() => saveFixedSalary(parsed)))
  }

  return (
    <section className="card">
      <h2>Salário fixo</h2>
      <p className="muted">O valor que você espera receber por mês. Serve de referência quando ainda não há histórico de salários líquidos.</p>
      <form className="inline-form" onSubmit={submit}>
        <Field label="Salário fixo (R$)">
          <input inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false) }} placeholder="0,00" />
        </Field>
        <button className="button primary" disabled={action.busy}>{action.busy ? 'Salvando…' : 'Salvar'}</button>
      </form>
      <ErrorMessage error={action.error} />
      {saved && <p className="info">Salário salvo.</p>}
      <p className="footnote">
        Usado nas projeções dos próximos meses: <strong>{formatBRL(projected.amount)}</strong>{' '}
        {projected.source === 'AVERAGE' && '(média dos salários líquidos)'}
        {projected.source === 'FIXED' && '(salário fixo)'}
      </p>
    </section>
  )
}

function SalaryHistoryCard({ onEdit }: { onEdit(e: SalaryEntry | 'new'): void }) {
  const data = useFinancialData()
  const { remove } = useData()
  const action = useAction()
  const average = averageNetSalary(data.salaryHistory)
  const window = latestSalaryEntries(data.salaryHistory).length

  return (
    <section className="card">
      <div className="section-header">
        <h2>Salário líquido por mês</h2>
        <button className="button" onClick={() => onEdit('new')}>+ Registrar</button>
      </div>
      {average !== null && (
        <div className="stat-inline">
          <span className="muted">Média dos últimos {window} {window === 1 ? 'mês' : 'meses'}</span>
          <strong>{formatBRL(average)}</strong>
        </div>
      )}
      <p className="footnote">
        A média usa os {SALARY_AVERAGE_WINDOW} meses mais recentes e passa a ser usada nas projeções a partir de {MIN_ENTRIES_FOR_AVERAGE} registros.
        No mês em que há salário registrado, o valor registrado é usado.
      </p>
      {data.salaryHistory.length === 0 ? (
        <EmptyState>Nenhum salário registrado ainda.</EmptyState>
      ) : (
        <ul className="item-list compact">
          {data.salaryHistory.map((e) => (
            <li key={e.id} className="item">
              <div className="item-main">
                <strong className="item-title">{formatMonthShort(monthOf(e.referenceMonth))}</strong>
                {e.receiptDate && <span className="item-sub">Recebido em {formatDate(e.receiptDate)}</span>}
              </div>
              <div className="item-side">
                <Money value={e.netAmount} />
                <div className="item-actions">
                  <button className="link-button" onClick={() => onEdit(e)}>Editar</button>
                  <button
                    className="link-button danger"
                    onClick={() => confirmDelete('este registro') && action.run(() => remove('salary_history', e.id))}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={action.error} />
    </section>
  )
}

function SalaryEntryForm({ entry, onDone }: { entry?: SalaryEntry; onDone(): void }) {
  const { saveSalaryEntry } = useData()
  const [month, setMonth] = useState(entry ? monthKey(monthOf(entry.referenceMonth)) : monthKey(currentMonth()))
  const [amount, setAmount] = useState(moneyInputValue(entry?.netAmount))
  const [receipt, setReceipt] = useState(entry?.receiptDate ?? todayISO())
  const action = useAction()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const net = parseMoney(amount)
    if (!month) return action.setError('Informe o mês.')
    if (net === null || net < 0) return action.setError('Informe um valor válido.')
    const ok = await action.run(() => saveSalaryEntry({ referenceMonth: `${month}-01`, netAmount: net, receiptDate: receipt || null }, entry?.id))
    if (ok) onDone()
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Mês de referência">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
      </Field>
      <Field label="Valor líquido recebido">
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
      </Field>
      <Field label="Data de recebimento">
        <input type="date" value={receipt} onChange={(e) => setReceipt(e.target.value)} />
      </Field>
      <ErrorMessage error={action.error} />
      <button className="button primary block" disabled={action.busy}>{action.busy ? 'Salvando…' : 'Salvar'}</button>
    </form>
  )
}

function describeSource(s: IncomeSource): string {
  const d = parseISODate(s.expectedDate)
  const when = {
    MONTHLY: `todo dia ${d.day}`,
    ANNUAL: `todo ano em ${formatDayMonth(d)}`,
    OCCASIONAL: `em ${formatDate(s.expectedDate)}`,
  }[s.recurrence]
  return `${INCOME_TYPE_LABEL[s.type]} · ${INCOME_RECURRENCE_LABEL[s.recurrence]} · ${when}`
}

function IncomeSourcesCard({ onEdit }: { onEdit(s: IncomeSource | 'new'): void }) {
  const data = useFinancialData()
  const { remove } = useData()
  const action = useAction()

  return (
    <section className="card">
      <div className="section-header">
        <h2>Outras rendas</h2>
        <button className="button" onClick={() => onEdit('new')}>+ Adicionar</button>
      </div>
      {data.incomeSources.length === 0 ? (
        <EmptyState>Aluguel, freelas, rendimentos… Cadastre aqui rendas além do salário.</EmptyState>
      ) : (
        <ul className="item-list compact">
          {data.incomeSources.map((s) => (
            <li key={s.id} className="item">
              <div className="item-main">
                <strong className="item-title">{s.name}</strong>
                <span className="item-sub">{describeSource(s)}</span>
              </div>
              <div className="item-side">
                <Money value={s.amount} />
                <div className="item-actions">
                  <button className="link-button" onClick={() => onEdit(s)}>Editar</button>
                  <button
                    className="link-button danger"
                    onClick={() => confirmDelete(`"${s.name}"`) && action.run(() => remove('income_sources', s.id))}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={action.error} />
    </section>
  )
}

const DATE_HINT: Record<IncomeRecurrence, string> = {
  MONTHLY: 'Data do primeiro recebimento. Repete todo mês no mesmo dia.',
  ANNUAL: 'Data do primeiro recebimento. Repete todo ano no mesmo dia e mês.',
  OCCASIONAL: 'Afeta apenas o mês desta data.',
}

function IncomeSourceForm({ source, onDone }: { source?: IncomeSource; onDone(): void }) {
  const { saveIncomeSource } = useData()
  const [name, setName] = useState(source?.name ?? '')
  const [amount, setAmount] = useState(moneyInputValue(source?.amount))
  const [type, setType] = useState<IncomeType>(source?.type ?? 'OTHER')
  const [recurrence, setRecurrence] = useState<IncomeRecurrence>(source?.recurrence ?? 'MONTHLY')
  const [date, setDate] = useState(source?.expectedDate ?? todayISO())
  const action = useAction()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = parseMoney(amount)
    if (!name.trim()) return action.setError('Informe um nome.')
    if (value === null || value < 0) return action.setError('Informe um valor válido.')
    if (!date) return action.setError('Informe a data prevista.')
    const ok = await action.run(() => saveIncomeSource({ name: name.trim(), amount: value, type, recurrence, expectedDate: date }, source?.id))
    if (ok) onDone()
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Nome">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Aluguel do apartamento" maxLength={120} required />
      </Field>
      <Field label="Valor">
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
      </Field>
      <div className="row">
        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value as IncomeType)}>
            {(Object.keys(INCOME_TYPE_LABEL) as IncomeType[]).map((t) => <option key={t} value={t}>{INCOME_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Recorrência">
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as IncomeRecurrence)}>
            {(Object.keys(INCOME_RECURRENCE_LABEL) as IncomeRecurrence[]).map((r) => (
              <option key={r} value={r}>{INCOME_RECURRENCE_LABEL[r]}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Data prevista" hint={DATE_HINT[recurrence]}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <ErrorMessage error={action.error} />
      <button className="button primary block" disabled={action.busy}>{action.busy ? 'Salvando…' : 'Salvar'}</button>
    </form>
  )
}
