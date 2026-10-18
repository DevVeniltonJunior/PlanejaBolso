import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CommitmentMeter } from '../components/CommitmentMeter'
import { Money } from '../components/ui'
import { useFinancialData } from '../data/DataContext'
import { parseISODate, todayISO } from '../domain/dates'
import {
  EXPENSE_TYPE_LABEL,
  EXPENSE_TYPE_PLURAL,
  formatBRL,
  formatCycleLong,
  formatDayMonth,
  formatMonthShort,
  formatPercent,
  formatPeriod,
} from '../domain/format'
import { currentCycle, projectCycles, type CycleProjection } from '../domain/projection'
import type { SalarySource } from '../domain/salary'

const SALARY_SOURCE_LABEL: Record<SalarySource, string> = {
  ACTUAL: 'salário líquido registrado no mês',
  AVERAGE: 'média dos últimos salários líquidos',
  FIXED: 'salário fixo informado',
  NONE: 'nenhum salário informado',
}

const HORIZONS = [3, 6, 12]

export function DashboardPage() {
  const data = useFinancialData()
  const [horizon, setHorizon] = useState(3)
  const [showDetails, setShowDetails] = useState(false)
  const cycles = useMemo(() => projectCycles(data, currentCycle(data, todayISO()), 12), [data])
  const current = cycles[0]
  const isEmpty = data.fixedSalary === null && data.salaryHistory.length === 0 && data.expenses.length === 0

  return (
    <div className="page">
      <section className="card hero">
        <p className="eyebrow">
          {formatCycleLong(current.cycle)} · {formatPeriod(current.period.start, current.period.end)}
        </p>

        <div className="hero-balance">
          <span className="muted">Deve sobrar</span>
          <strong className={current.balance < 0 ? 'big negative' : 'big'}>{formatBRL(current.balance)}</strong>
        </div>

        <div className="hero-stats">
          <div>
            <span className="muted">Renda prevista</span>
            <strong>{formatBRL(current.income.total)}</strong>
          </div>
          <div>
            <span className="muted">Despesas previstas</span>
            <strong>{formatBRL(current.expenses.total)}</strong>
          </div>
          <div>
            <span className="muted">Comprometido</span>
            <strong>{formatPercent(current.commitment)}</strong>
          </div>
        </div>

        <CommitmentMeter value={current.commitment} />
        <p className="footnote">
          {current.commitment === null
            ? 'Cadastre sua renda para ver quanto dela já está comprometido.'
            : `${formatPercent(current.commitment)} da sua renda prevista já está comprometida com despesas registradas.`}{' '}
          Valores são uma projeção, não o saldo da sua conta.
        </p>
        <p className="footnote">
          Seu ciclo começa no dia de pagamento (dia {data.defaultPaymentDay}) e vai até a véspera do próximo. Contas que vencem em{' '}
          {formatDayMonth(parseISODate(current.period.settlement))} fecham este ciclo. <Link to="/despesas">Alterar o dia</Link>
        </p>

        <div className="actions">
          <Link className="button primary" to="/simular">Simular compra</Link>
          <Link className="button" to="/despesas?novo=1">+ Despesa</Link>
          <Link className="button" to="/renda?novo=1">+ Renda</Link>
        </div>
      </section>

      {isEmpty && (
        <section className="card onboarding">
          <h2>Comece por aqui</h2>
          <ol>
            <li><Link to="/renda">Informe seu salário</Link> e outras rendas.</li>
            <li><Link to="/cartoes">Cadastre seus cartões</Link> (apenas apelido e datas).</li>
            <li><Link to="/despesas">Registre suas despesas</Link>: contas fixas, assinaturas, parcelas e gastos do mês.</li>
          </ol>
        </section>
      )}

      <section className="card">
        <h2>Despesas deste ciclo</h2>
        <div className="breakdown">
          {(['FIXED', 'INSTALLMENT', 'SUBSCRIPTION', 'OCCASIONAL'] as const).map((type) => (
            <div key={type} className={`breakdown-item type-${type.toLowerCase()}`}>
              <span>{EXPENSE_TYPE_PLURAL[type]}</span>
              <strong>{formatBRL(breakdownValue(current, type))}</strong>
            </div>
          ))}
        </div>
        <button className="link-button" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? 'Ocultar detalhes' : 'Ver detalhes do ciclo'}
        </button>
        {showDetails && <CycleDetails projection={current} />}
      </section>

      <section className="card">
        <div className="section-header">
          <h2>Próximos ciclos</h2>
          <div className="segmented small">
            {HORIZONS.map((h) => (
              <button key={h} className={h === horizon ? 'active' : ''} onClick={() => setHorizon(h)}>
                {h} ciclos
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Ciclo</th>
                <th className="num">Renda</th>
                <th className="num">Despesas</th>
                <th className="num">Sobra</th>
                <th className="num">Compr.</th>
              </tr>
            </thead>
            <tbody>
              {cycles.slice(0, horizon).map((m, i) => (
                <tr key={i} className={i === 0 ? 'current' : ''}>
                  <td>
                    {formatMonthShort(m.cycle)}
                    <small className="muted period">{formatPeriod(m.period.start, m.period.end)}</small>
                  </td>
                  <td className="num">{formatBRL(m.income.total)}</td>
                  <td className="num">{formatBRL(m.expenses.total)}</td>
                  <td className="num"><Money value={m.balance} /></td>
                  <td className="num">{formatPercent(m.commitment)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="footnote">
          Cada ciclo inclui despesas fixas, assinaturas, parcelas e as faturas de cartão que ele paga. Uma compra no cartão entra
          no ciclo que paga a fatura dela, não no mês da compra. Gastos avulsos futuros ainda não existem e não são estimados.
        </p>
      </section>
    </div>
  )
}

function breakdownValue(p: CycleProjection, type: 'FIXED' | 'INSTALLMENT' | 'SUBSCRIPTION' | 'OCCASIONAL') {
  return { FIXED: p.expenses.fixed, INSTALLMENT: p.expenses.installments, SUBSCRIPTION: p.expenses.subscriptions, OCCASIONAL: p.expenses.occasional }[type]
}

function CycleDetails({ projection: p }: { projection: CycleProjection }) {
  return (
    <div className="details">
      <h3>Renda</h3>
      <ul className="line-list">
        <li>
          <span>Salário de {formatMonthShort(p.cycle)} <small className="muted">({SALARY_SOURCE_LABEL[p.income.salarySource]})</small></span>
          <Money value={p.income.salary} />
        </li>
        {p.income.items.map((i) => (
          <li key={i.sourceId}>
            <span><small className="muted day">{formatDayMonth(parseISODate(i.date))}</small> {i.name}</span>
            <Money value={i.amount} />
          </li>
        ))}
      </ul>
      <h3>Despesas, por data de pagamento</h3>
      <p className="footnote">Faturas de cartão aparecem na data de vencimento do cartão.</p>
      {p.expenses.items.length === 0 ? (
        <p className="muted">Nenhuma despesa prevista neste mês.</p>
      ) : (
        <ul className="line-list">
          {p.expenses.items.map((e, idx) => (
            <li key={`${e.expenseId}-${idx}`}>
              <span>
                <small className="muted day">{formatDayMonth(parseISODate(e.date))}</small>{' '}
                <span className={`badge type-${e.type.toLowerCase()}`}>{EXPENSE_TYPE_LABEL[e.type]}</span> {e.name}
                {e.installmentLabel && <small className="muted"> ({e.installmentLabel})</small>}
                {e.cardName && e.statementMonth && (
                  <small className="muted"> · fatura {e.cardName} de {formatMonthShort(e.statementMonth)}</small>
                )}
              </span>
              <Money value={e.amount} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
