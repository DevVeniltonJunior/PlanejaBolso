import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ExpenseForm } from '../components/ExpenseForm'
import { EmptyState, Modal, Money, confirmDelete, useAction } from '../components/ui'
import { useData, useFinancialData } from '../data/DataContext'
import { addMonths, currentMonth, monthsBetween } from '../domain/dates'
import {
  CATEGORY_LABEL,
  EXPENSE_TYPE_LABEL,
  PAYMENT_LABEL,
  RECURRENCE_LABEL,
  formatBRL,
  formatDate,
  formatDayMonth,
  formatMonthShort,
} from '../domain/format'
import { firstInstallmentMonth, installmentTotal, paymentMonth } from '../domain/projection'
import type { CreditCard, Expense, ExpenseType } from '../domain/types'

type Filter = 'ALL' | ExpenseType
const FILTERS: Filter[] = ['ALL', 'FIXED', 'SUBSCRIPTION', 'INSTALLMENT', 'OCCASIONAL']

export function ExpensesPage() {
  const data = useFinancialData()
  const { saveExpense, remove } = useData()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>('ALL')
  const [editing, setEditing] = useState<Expense | 'new' | null>(params.get('novo') ? 'new' : null)
  const action = useAction()

  const cards = useMemo(() => new Map(data.cards.map((c) => [c.id, c])), [data.cards])
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
                <span className="item-sub">{describe(e, cards)}</span>
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

function describe(e: Expense, cards: Map<string, CreditCard>): string {
  const cardName = (id: string | null) => (id && cards.get(id)?.nickname) || 'cartão'
  switch (e.type) {
    case 'FIXED':
    case 'SUBSCRIPTION': {
      const when =
        e.recurrence === 'MONTHLY' ? `todo dia ${e.chargeDay}` : `todo ano em ${formatDayMonth({ day: e.chargeDay, month: e.chargeMonth ?? 1 })}`
      const category = e.type === 'FIXED' ? ` · ${CATEGORY_LABEL[e.category]}` : ''
      return `${RECURRENCE_LABEL[e.recurrence]} · ${when}${category}`
    }
    case 'INSTALLMENT': {
      const first = firstInstallmentMonth(e, cards)
      const last = addMonths(first, e.installmentsCount - 1)
      const k = monthsBetween(first, currentMonth())
      const status =
        k < 0 ? `começa em ${formatMonthShort(first)}` : k >= e.installmentsCount ? 'quitada' : `parcela ${k + 1}/${e.installmentsCount} este mês`
      const method = e.paymentMethod === 'CREDIT_CARD' ? cardName(e.cardId) : PAYMENT_LABEL[e.paymentMethod]
      return `${e.installmentsCount}× · total ${formatBRL(installmentTotal(e))} · ${method} · ${status} · até ${formatMonthShort(last)}`
    }
    case 'OCCASIONAL': {
      const base = `${formatDate(e.purchaseDate)} · `
      if (e.paymentMethod !== 'CREDIT_CARD') return base + PAYMENT_LABEL[e.paymentMethod]
      return `${base}${cardName(e.cardId)} · fatura de ${formatMonthShort(paymentMonth(e, cards))}`
    }
  }
}
