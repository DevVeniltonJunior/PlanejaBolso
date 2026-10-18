import { useState, type FormEvent } from 'react'
import { DAY_OPTIONS, EmptyState, ErrorMessage, Field, Modal, confirmDelete, useAction } from '../components/ui'
import { useData, useFinancialData } from '../data/DataContext'
import { billingMonth, statementClosingDate, statementDueDate } from '../domain/billing'
import { todayISO } from '../domain/dates'
import { formatDayMonth, formatMonthShort } from '../domain/format'
import type { CreditCard } from '../domain/types'

export function CardsPage() {
  const data = useFinancialData()
  const { remove } = useData()
  const [editing, setEditing] = useState<CreditCard | 'new' | null>(null)
  const action = useAction()

  return (
    <div className="page">
      <div className="page-header">
        <h1>Cartões</h1>
        <button className="button primary" onClick={() => setEditing('new')}>+ Novo cartão</button>
      </div>
      <p className="muted">
        Só precisamos de um apelido e das datas da fatura para projetar suas compras. Nunca informe número, CVV ou validade do cartão.
      </p>

      {data.cards.length === 0 ? (
        <EmptyState>Nenhum cartão cadastrado.</EmptyState>
      ) : (
        <ul className="item-list">
          {data.cards.map((c) => {
            const next = billingMonth(c, todayISO())
            return (
              <li key={c.id} className="item">
                <div className="item-main">
                  <strong className="item-title">{c.nickname}</strong>
                  <span className="item-sub">
                    Vence dia {c.dueDay} · fecha {c.closingDaysBefore} dias antes
                  </span>
                  <span className="item-sub">
                    Compras de hoje entram na fatura de <strong>{formatMonthShort(next)}</strong> (fecha{' '}
                    {formatDayMonth(statementClosingDate(c, next))}, vence {formatDayMonth(statementDueDate(c, next))})
                  </span>
                </div>
                <div className="item-side">
                  <div className="item-actions">
                    <button className="link-button" onClick={() => setEditing(c)}>Editar</button>
                    <button
                      className="link-button danger"
                      onClick={() => confirmDelete(`o cartão "${c.nickname}"`) && action.run(() => remove('credit_cards', c.id))}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ErrorMessage error={action.error} />

      {editing && (
        <Modal title={editing === 'new' ? 'Novo cartão' : 'Editar cartão'} onClose={() => setEditing(null)}>
          <CardForm card={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  )
}

function CardForm({ card, onDone }: { card?: CreditCard; onDone(): void }) {
  const { saveCard } = useData()
  const [nickname, setNickname] = useState(card?.nickname ?? '')
  const [dueDay, setDueDay] = useState(String(card?.dueDay ?? 5))
  const [closing, setClosing] = useState(String(card?.closingDaysBefore ?? 7))
  const action = useAction()

  const preview: CreditCard = { id: '', nickname, dueDay: Number(dueDay), closingDaysBefore: Number(closing) || 1 }
  const next = billingMonth(preview, todayISO())

  async function submit(e: FormEvent) {
    e.preventDefault()
    const days = Number(closing)
    if (!nickname.trim()) return action.setError('Informe um apelido.')
    if (!Number.isInteger(days) || days < 1 || days > 28) return action.setError('Dias entre fechamento e vencimento: de 1 a 28.')
    const ok = await action.run(() => saveCard({ nickname: nickname.trim(), dueDay: Number(dueDay), closingDaysBefore: days }, card?.id))
    if (ok) onDone()
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Apelido" hint='Ex.: "Cartão final 42" ou "Nubank"'>
        <input value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={60} required />
      </Field>
      <div className="row">
        <Field label="Dia do vencimento">
          <select value={dueDay} onChange={(e) => setDueDay(e.target.value)}>
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Fecha quantos dias antes?">
          <input type="number" min={1} max={28} value={closing} onChange={(e) => setClosing(e.target.value)} required />
        </Field>
      </div>
      <p className="info">
        Próxima fatura: {formatMonthShort(next)} — fecha em {formatDayMonth(statementClosingDate(preview, next))} e vence em{' '}
        {formatDayMonth(statementDueDate(preview, next))}. Compras a partir do dia do fechamento vão para a fatura seguinte.
      </p>
      <ErrorMessage error={action.error} />
      <button className="button primary block" disabled={action.busy}>{action.busy ? 'Salvando…' : 'Salvar'}</button>
    </form>
  )
}
