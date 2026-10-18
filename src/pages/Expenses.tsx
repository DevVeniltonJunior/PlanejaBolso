import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExpenseForm } from '../components/ExpenseForm'
import { DAY_OPTIONS, EmptyState, ErrorMessage, Field, Modal, Money, confirmDelete, useAction } from '../components/ui'
import { useData, useFinancialData } from '../data/DataContext'
import { cycleEnd, cycleSettlementDate, cycleStart } from '../domain/cycle'
import { monthsBetween, toISODate, todayISO } from '../domain/dates'
import {
  CATEGORY_LABEL,
  EXPENSE_TYPE_LABEL,
  PAYMENT_LABEL,
  RECURRENCE_LABEL,
  formatBRL,
  formatDate,
  formatDayMonth,
  formatMonthShort,
  formatPeriod,
} from '../domain/format'
import {
  currentCycle,
  effectivePaymentDay,
  installmentTotal,
  placeInstallment,
  placeOccasional,
  projectionContext,
} from '../domain/projection'
import type { Expense, ExpenseType, FinancialData } from '../domain/types'

type Filter = 'ALL' | ExpenseType
const FILTERS: Filter[] = ['ALL', 'FIXED', 'SUBSCRIPTION', 'INSTALLMENT', 'OCCASIONAL']

export function ExpensesPage() {
  const data = useFinancialData()
  const { saveExpense, remove } = useData()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [editing, setEditing] = useState<Expense | 'new' | null>(params.get('novo') ? 'new' : null)
  const action = useAction()

  const list = data.expenses.filter((e) => filter === 'ALL' || e.type === filter)

  function close() {
    setEditing(null)
    action.setError(null)
    if (params.has('novo')) setParams({}, { replace: true })
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Despesas</h1>
        <button className="button primary" onClick={() => setEditing('new')}>+ Nova despesa</button>
      </div>

      <DefaultPaymentDayCard />

      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'ALL' ? 'Todas' : EXPENSE_TYPE_LABEL[f]}
            <span className="chip-count">{f === 'ALL' ? data.expenses.length : data.expenses.filter((e) => e.type === f).length}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <EmptyState>Nenhuma despesa {filter === 'ALL' ? 'registrada' : 'deste tipo'} ainda.</EmptyState>
      ) : (
        <ul className="item-list">
          {list.map((e) => (
            <li key={e.id} className="item">
              <div className="item-main">
                <span className={`badge type-${e.type.toLowerCase()}`}>{EXPENSE_TYPE_LABEL[e.type]}</span>
                <strong className="item-title">{e.name}</strong>
                <span className="item-sub">{describe(e, data)}</span>
              </div>
              <div className="item-side">
                <Money value={e.type === 'INSTALLMENT' ? e.installmentAmount : e.amount} />
                <div className="item-actions">
                  <button className="link-button" onClick={() => setEditing(e)}>Editar</button>
                  <button
                    className="link-button danger"
                    onClick={() => confirmDelete(`"${e.name}"`) && action.run(() => remove('expenses', e.id))}
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!editing && action.error && <p className="error">{action.error}</p>}

      {editing && (
        <Modal title={editing === 'new' ? 'Nova despesa' : 'Editar despesa'} onClose={close}>
          <ExpenseForm
            initial={editing === 'new' ? undefined : editing}
            initialType={filter === 'ALL' ? 'OCCASIONAL' : filter}
            cards={data.cards}
            defaultPaymentDay={data.defaultPaymentDay}
            busy={action.busy}
            error={action.error}
            onSubmit={async (expense) => {
              if (await action.run(() => saveExpense(expense, editing === 'new' ? undefined : editing.id))) close()
            }}
          />
        </Modal>
      )}
    </div>
  )
}

function describe(e: Expense, data: FinancialData): string {
  const ctx = projectionContext(data)
  switch (e.type) {
    case 'FIXED':
    case 'SUBSCRIPTION': {
      const day = effectivePaymentDay(e, data.defaultPaymentDay)
      const when =
        (e.recurrence === 'MONTHLY' ? `todo dia ${day}` : `todo ano em ${formatDayMonth({ day, month: e.chargeMonth ?? 1 })}`) +
        (e.paymentDayOverride === null ? ' (dia padrão)' : '')
      const category = e.type === 'FIXED' ? ` · ${CATEGORY_LABEL[e.category]}` : ''
      return `${RECURRENCE_LABEL[e.recurrence]} · ${when}${category}`
    }
    case 'INSTALLMENT': {
      const first = placeInstallment(e, 0, ctx)
      const last = placeInstallment(e, e.installmentsCount - 1, ctx)
      const k = monthsBetween(first.cycle, currentCycle(data, todayISO()))
      const status =
        k < 0
          ? `1ª parcela em ${formatDate(first.date)} (ciclo de ${formatMonthShort(first.cycle)})`
          : k >= e.installmentsCount
            ? 'quitada'
            : `parcela ${k + 1}/${e.installmentsCount} neste ciclo`
      const method = first.card ? first.card.nickname : PAYMENT_LABEL[e.paymentMethod]
      return `${e.installmentsCount}× · total ${formatBRL(installmentTotal(e))} · ${method} · ${status} · até o ciclo de ${formatMonthShort(last.cycle)}`
    }
    case 'OCCASIONAL': {
      const p = placeOccasional(e, ctx)
      const base = `${formatDate(e.purchaseDate)} · `
      if (!p.card || !p.statementMonth) return `${base}${PAYMENT_LABEL[e.paymentMethod]} · ciclo de ${formatMonthShort(p.cycle)}`
      return `${base}${p.card.nickname} · fatura de ${formatMonthShort(p.statementMonth)} (vence ${formatDate(p.date)}) · ciclo de ${formatMonthShort(p.cycle)}`
    }
  }
}

function DefaultPaymentDayCard() {
  const data = useFinancialData()
  const { saveDefaultPaymentDay } = useData()
  const [day, setDay] = useState(String(data.defaultPaymentDay))
  const action = useAction()
  const preview = Number(day)
  const cycle = currentCycle({ defaultPaymentDay: preview }, todayISO())

  async function submit(e: FormEvent) {
    e.preventDefault()
    await action.run(() => saveDefaultPaymentDay(preview))
  }

  return (
    <section className="card">
      <form className="inline-form" onSubmit={submit}>
        <Field label="Dia em que costumo pagar minhas contas">
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>Dia {d}</option>)}
          </select>
        </Field>
        <button className="button" disabled={action.busy || preview === data.defaultPaymentDay}>
          {action.busy ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
      <ErrorMessage error={action.error} />
      <p className="footnote">
        Este dia define seu ciclo financeiro: o ciclo atual ({formatMonthShort(cycle)}) vai de{' '}
        {formatPeriod(toISODate(cycleStart(cycle, preview)), toISODate(cycleEnd(cycle, preview)))}, e contas que vencem em{' '}
        {formatDayMonth(cycleSettlementDate(cycle, preview))} ainda são pagas por ele. Despesas fixas e assinaturas sem dia específico
        são pagas neste dia. Faturas de cartão vencem no dia do próprio cartão e entram no ciclo que as paga.
      </p>
    </section>
  )
}
