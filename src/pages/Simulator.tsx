import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CommitmentMeter } from '../components/CommitmentMeter'
import { ErrorMessage, Field, Money, useAction } from '../components/ui'
import { useData, useFinancialData } from '../data/DataContext'
import { currentMonth, todayISO } from '../domain/dates'
import { PAYMENT_LABEL, formatBRL, formatMonthLong, formatMonthShort, formatPercent } from '../domain/format'
import { parseMoney } from '../domain/money'
import { installmentAmountFor, simulatePurchase, type PurchaseSimulationInput } from '../domain/simulation'
import type { PaymentMethod } from '../domain/types'

export function SimulatorPage() {
  const data = useFinancialData()
  const { saveExpense } = useData()
  const [description, setDescription] = useState('')
  const [amountText, setAmountText] = useState('')
  const [method, setMethod] = useState<PaymentMethod>(data.cards.length ? 'CREDIT_CARD' : 'PIX')
  const [cardId, setCardId] = useState(data.cards[0]?.id ?? '')
  const [split, setSplit] = useState(false)
  const [installments, setInstallments] = useState('3')
  const [added, setAdded] = useState(false)
  const action = useAction()

  const amount = parseMoney(amountText)
  const isCard = method === 'CREDIT_CARD'
  const count = isCard && split ? Math.min(Math.max(Math.floor(Number(installments) || 1), 1), 120) : 1
  const cardMissing = isCard && !data.cards.some((c) => c.id === cardId)

  const input: PurchaseSimulationInput | null =
    amount && amount > 0 && !cardMissing
      ? { description, amount, paymentMethod: method, cardId: isCard ? cardId : null, installments: count, purchaseDate: todayISO() }
      : null

  // Cheap to compute; recalculated on every change so it always matches the dashboard.
  const result = input && !added ? simulatePurchase(data, input, currentMonth()) : null

  const firstImpact = result?.rows.find((r) => r.balanceDifference !== 0) ?? result?.rows[0]

  function resetAdded() {
    setAdded(false)
    action.setError(null)
  }

  async function addToExpenses() {
    if (!result) return
    const what = count > 1 ? `${count}× de ${formatBRL(installmentAmountFor(amount!, count))}` : formatBRL(amount!)
    if (!window.confirm(`Adicionar "${result.expense.name}" (${what}) às suas despesas?`)) return
    if (await action.run(() => saveExpense(result.expense))) setAdded(true)
  }

  return (
    <div className="page">
      <h1>Simular compra</h1>
      <p className="muted">Veja o impacto de uma compra antes de fazê-la. Nada é salvo até você confirmar.</p>

      <section className="card">
        <div className="form" onChange={resetAdded}>
          <Field label="Valor da compra">
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0,00" autoFocus />
          </Field>
          <Field label="Descrição (opcional)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Tênis novo" maxLength={120} />
          </Field>
          <Field label="Forma de pagamento">
            <div className="segmented wrap">
              {(['CREDIT_CARD', 'PIX', 'CASH'] as const).map((p) => (
                <button key={p} type="button" className={method === p ? 'active' : ''} onClick={() => { setMethod(p); resetAdded() }}>
                  {PAYMENT_LABEL[p]}
                </button>
              ))}
            </div>
          </Field>
          {isCard &&
            (data.cards.length === 0 ? (
              <p className="info">
                <Link to="/cartoes">Cadastre um cartão</Link> para simular compras no crédito.
              </p>
            ) : (
              <>
                <Field label="Cartão">
                  <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                    {data.cards.map((c) => <option key={c.id} value={c.id}>{c.nickname}</option>)}
                  </select>
                </Field>
                <div className="segmented">
                  <button type="button" className={!split ? 'active' : ''} onClick={() => { setSplit(false); resetAdded() }}>À vista</button>
                  <button type="button" className={split ? 'active' : ''} onClick={() => { setSplit(true); resetAdded() }}>Parcelado</button>
                </div>
                {split && (
                  <Field
                    label="Número de parcelas"
                    hint={amount ? `${count}× de ${formatBRL(installmentAmountFor(amount, count))}` : undefined}
                  >
                    <input type="number" min={2} max={120} value={installments} onChange={(e) => setInstallments(e.target.value)} />
                  </Field>
                )}
              </>
            ))}
        </div>
      </section>

      {result && firstImpact && (
        <>
          <section className="card comparison">
            <p className="eyebrow">Comprometimento da renda em {formatMonthLong(firstImpact.month)}</p>
            <div className="compare">
              <div>
                <span className="muted">Hoje</span>
                <strong className="big">{formatPercent(firstImpact.before.commitment)}</strong>
              </div>
              <span className="compare-arrow" aria-hidden>→</span>
              <div>
                <span className="muted">Com a compra</span>
                <strong className={`big ${(firstImpact.after.commitment ?? 0) > 100 ? 'negative' : 'accent'}`}>
                  {formatPercent(firstImpact.after.commitment)}
                </strong>
              </div>
            </div>
            <CommitmentMeter value={firstImpact.after.commitment} compareTo={firstImpact.before.commitment} />
            <p className="compare-balance">
              Deve sobrar <Money value={firstImpact.before.balance} /> → <strong><Money value={firstImpact.after.balance} /></strong>
            </p>
            {firstImpact.after.balance < 0 && (
              <p className="warning">Com esta compra, as despesas previstas de {formatMonthShort(firstImpact.month)} superam a renda prevista.</p>
            )}
            <p className="footnote">Simulação baseada nas suas despesas e rendas registradas. É uma projeção, não uma recomendação.</p>
          </section>

          <section className="card">
            <h2>Mês a mês</h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th className="num">Sobra hoje</th>
                    <th className="num">Com a compra</th>
                    <th className="num">Compr.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className={r.balanceDifference !== 0 ? 'affected' : ''}>
                      <td>{formatMonthShort(r.month)}</td>
                      <td className="num"><Money value={r.before.balance} /></td>
                      <td className="num">
                        <strong><Money value={r.after.balance} /></strong>
                        {r.balanceDifference !== 0 && <small className="diff"><Money value={r.balanceDifference} signed /></small>}
                      </td>
                      <td className="num">
                        {formatPercent(r.before.commitment)} → <strong>{formatPercent(r.after.commitment)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card add-expense">
            <p className="muted">Decidiu comprar? Adicione a compra às suas despesas para que ela entre nas projeções.</p>
            <button className="button primary block" onClick={addToExpenses} disabled={action.busy}>
              {action.busy ? 'Adicionando…' : 'Adicionar às minhas despesas'}
            </button>
            <ErrorMessage error={action.error} />
          </section>
        </>
      )}

      {added && (
        <section className="card add-expense">
          <p className="info">
            Compra adicionada às suas despesas e já incluída nas projeções. <Link to="/despesas">Ver despesas</Link> ·{' '}
            <Link to="/">Ver painel</Link>
          </p>
          <button className="button block" onClick={() => { setAmountText(''); setDescription(''); resetAdded() }}>
            Simular outra compra
          </button>
        </section>
      )}
    </div>
  )
}
