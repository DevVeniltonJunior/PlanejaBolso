import { useState, type FormEvent } from 'react'
import { billingMonth } from '../domain/billing'
import { currentMonth, monthKey, todayISO } from '../domain/dates'
import {
  CATEGORY_LABEL,
  EXPENSE_TYPE_LABEL,
  PAYMENT_LABEL,
  RECURRENCE_LABEL,
  formatBRL,
  formatMonthShort,
  monthName,
  moneyInputValue,
} from '../domain/format'
import { parseMoney, roundMoney } from '../domain/money'
import type { CreditCard, Expense, ExpenseType, FixedCategory, NewExpense, PaymentMethod, Recurrence } from '../domain/types'
import { DAY_OPTIONS, ErrorMessage, Field } from './ui'

interface FormState {
  type: ExpenseType
  name: string
  amount: string
  recurrence: Recurrence
  category: FixedCategory
  chargeDay: string
  chargeMonth: string
  startDate: string
  installmentsCount: string
  purchaseDate: string
  paymentMethod: PaymentMethod
  cardId: string
  firstPaymentDate: string
}

function initialState(initial: Expense | undefined, type: ExpenseType, cards: CreditCard[]): FormState {
  const s: FormState = {
    type,
    name: '',
    amount: '',
    recurrence: 'MONTHLY',
    category: 'BILL',
    chargeDay: '10',
    chargeMonth: String(new Date().getMonth() + 1),
    startDate: `${monthKey(currentMonth())}-01`,
    installmentsCount: '2',
    purchaseDate: todayISO(),
    paymentMethod: cards.length ? 'CREDIT_CARD' : 'PIX',
    cardId: cards[0]?.id ?? '',
    firstPaymentDate: todayISO(),
  }
  if (!initial) return s
  s.type = initial.type
  s.name = initial.name
  switch (initial.type) {
    case 'FIXED':
    case 'SUBSCRIPTION':
      s.amount = moneyInputValue(initial.amount)
      s.recurrence = initial.recurrence
      s.chargeDay = String(initial.chargeDay)
      s.chargeMonth = String(initial.chargeMonth ?? s.chargeMonth)
      s.startDate = initial.startDate
      if (initial.type === 'FIXED') s.category = initial.category
      break
    case 'INSTALLMENT':
      s.amount = moneyInputValue(initial.installmentAmount)
      s.installmentsCount = String(initial.installmentsCount)
      s.purchaseDate = initial.purchaseDate
      s.paymentMethod = initial.paymentMethod
      s.cardId = initial.cardId ?? s.cardId
      s.firstPaymentDate = initial.firstPaymentDate ?? s.firstPaymentDate
      break
    case 'OCCASIONAL':
      s.amount = moneyInputValue(initial.amount)
      s.purchaseDate = initial.purchaseDate
      s.paymentMethod = initial.paymentMethod
      s.cardId = initial.cardId ?? s.cardId
      break
  }
  return s
}

function build(s: FormState, cards: CreditCard[]): NewExpense | string {
  const name = s.name.trim()
  if (!name) return 'Informe um nome.'
  const amount = parseMoney(s.amount)
  if (amount === null || amount <= 0) return 'Informe um valor válido.'
  const isCard = s.paymentMethod === 'CREDIT_CARD'
  if ((s.type === 'INSTALLMENT' || s.type === 'OCCASIONAL') && isCard && !cards.some((c) => c.id === s.cardId)) {
    return 'Selecione um cartão.'
  }
  switch (s.type) {
    case 'FIXED':
    case 'SUBSCRIPTION': {
      if (!s.startDate) return 'Informe a data de início.'
      const recurring = {
        name,
        amount,
        recurrence: s.recurrence,
        chargeDay: Number(s.chargeDay),
        chargeMonth: s.recurrence === 'ANNUAL' ? Number(s.chargeMonth) : null,
        startDate: s.startDate,
      }
      return s.type === 'FIXED' ? { ...recurring, type: 'FIXED', category: s.category } : { ...recurring, type: 'SUBSCRIPTION' }
    }
    case 'INSTALLMENT': {
      const count = Number(s.installmentsCount)
      if (!Number.isInteger(count) || count < 1 || count > 120) return 'Número de parcelas deve ser entre 1 e 120.'
      if (!s.purchaseDate) return 'Informe a data da compra.'
      if (!isCard && !s.firstPaymentDate) return 'Informe a data do primeiro pagamento.'
      return {
        type: 'INSTALLMENT',
        name,
        installmentAmount: amount,
        installmentsCount: count,
        purchaseDate: s.purchaseDate,
        paymentMethod: s.paymentMethod,
        cardId: isCard ? s.cardId : null,
        firstPaymentDate: isCard ? null : s.firstPaymentDate,
      }
    }
    case 'OCCASIONAL':
      if (!s.purchaseDate) return 'Informe a data da compra.'
      return {
        type: 'OCCASIONAL',
        name,
        amount,
        purchaseDate: s.purchaseDate,
        paymentMethod: s.paymentMethod,
        cardId: isCard ? s.cardId : null,
      }
  }
}

const TYPES: ExpenseType[] = ['FIXED', 'SUBSCRIPTION', 'INSTALLMENT', 'OCCASIONAL']
const TYPE_HINT: Record<ExpenseType, string> = {
  FIXED: 'Contas e obrigações que se repetem: luz, água, condomínio, IPTU, IPVA…',
  SUBSCRIPTION: 'Serviços recorrentes: streaming, música, nuvem, academia…',
  INSTALLMENT: 'Compras divididas em parcelas. As parcelas futuras são calculadas automaticamente.',
  OCCASIONAL: 'Gastos pontuais: mercado, farmácia, restaurante, roupas…',
}

export function ExpenseForm({
  initial,
  initialType = 'OCCASIONAL',
  cards,
  busy,
  error,
  onSubmit,
}: {
  initial?: Expense
  initialType?: ExpenseType
  cards: CreditCard[]
  busy: boolean
  error: string | null
  onSubmit(expense: NewExpense): void
}) {
  const [s, setS] = useState(() => initialState(initial, initialType, cards))
  const [validation, setValidation] = useState<string | null>(null)
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setS((prev) => ({ ...prev, [key]: value }))

  const amount = parseMoney(s.amount)
  const card = cards.find((c) => c.id === s.cardId)
  const usesPayment = s.type === 'INSTALLMENT' || s.type === 'OCCASIONAL'
  const isCard = usesPayment && s.paymentMethod === 'CREDIT_CARD'
  const statement = isCard && card && s.purchaseDate ? billingMonth(card, s.purchaseDate) : null

  function submit(e: FormEvent) {
    e.preventDefault()
    const result = build(s, cards)
    if (typeof result === 'string') return setValidation(result)
    setValidation(null)
    onSubmit(result)
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Tipo de despesa" hint={TYPE_HINT[s.type]}>
        <div className="segmented wrap">
          {TYPES.map((t) => (
            <button key={t} type="button" className={s.type === t ? 'active' : ''} onClick={() => set('type', t)}>
              {EXPENSE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Nome">
        <input value={s.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Conta de luz" maxLength={120} required />
      </Field>

      <Field label={s.type === 'INSTALLMENT' ? 'Valor da parcela' : 'Valor'}>
        <input inputMode="decimal" value={s.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0,00" required />
      </Field>

      {(s.type === 'FIXED' || s.type === 'SUBSCRIPTION') && (
        <>
          <div className="row">
            <Field label="Recorrência">
              <select value={s.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
                {(['MONTHLY', 'ANNUAL'] as const).map((r) => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
              </select>
            </Field>
            {s.type === 'FIXED' && (
              <Field label="Categoria">
                <select value={s.category} onChange={(e) => set('category', e.target.value as FixedCategory)}>
                  {(['BILL', 'TAX', 'OTHER'] as const).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div className="row">
            <Field label="Dia da cobrança">
              <select value={s.chargeDay} onChange={(e) => set('chargeDay', e.target.value)}>
                {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            {s.recurrence === 'ANNUAL' && (
              <Field label="Mês da cobrança">
                <select value={s.chargeMonth} onChange={(e) => set('chargeMonth', e.target.value)}>
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{monthName(i + 1)}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Começa em" hint="A primeira cobrança considerada é a que cai nesta data ou depois.">
            <input type="date" value={s.startDate} onChange={(e) => set('startDate', e.target.value)} required />
          </Field>
        </>
      )}

      {usesPayment && (
        <>
          {s.type === 'INSTALLMENT' && (
            <Field
              label="Número de parcelas"
              hint={amount ? `Total da compra: ${formatBRL(roundMoney(amount * (Number(s.installmentsCount) || 0)))}` : undefined}
            >
              <input type="number" min={1} max={120} value={s.installmentsCount} onChange={(e) => set('installmentsCount', e.target.value)} required />
            </Field>
          )}
          <Field label="Data da compra">
            <input type="date" value={s.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} required />
          </Field>
          <Field label="Forma de pagamento">
            <select value={s.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value as PaymentMethod)}>
              {(['CREDIT_CARD', 'PIX', 'CASH'] as const).map((p) => <option key={p} value={p}>{PAYMENT_LABEL[p]}</option>)}
            </select>
          </Field>
          {isCard &&
            (cards.length === 0 ? (
              <p className="info">Cadastre um cartão na aba Cartões para usar esta forma de pagamento.</p>
            ) : (
              <Field
                label="Cartão"
                hint={statement && `${s.type === 'INSTALLMENT' ? 'Primeira parcela na fatura' : 'Entra na fatura'} de ${formatMonthShort(statement)}`}
              >
                <select value={s.cardId} onChange={(e) => set('cardId', e.target.value)}>
                  {cards.map((c) => <option key={c.id} value={c.id}>{c.nickname}</option>)}
                </select>
              </Field>
            ))}
          {s.type === 'INSTALLMENT' && !isCard && (
            <Field label="Data do primeiro pagamento" hint="As demais parcelas são calculadas mês a mês a partir desta data.">
              <input type="date" value={s.firstPaymentDate} onChange={(e) => set('firstPaymentDate', e.target.value)} required />
            </Field>
          )}
        </>
      )}

      <ErrorMessage error={validation ?? error} />
      <button className="button primary block" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
    </form>
  )
}
