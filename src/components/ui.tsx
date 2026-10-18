import { useEffect, useState, type ReactNode } from 'react'
import { formatBRL } from '../domain/format'

export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.classList.add('no-scroll')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('no-scroll')
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Money({ value, signed = false }: { value: number; signed?: boolean }) {
  const cls = value < 0 ? 'money negative' : 'money'
  return <span className={cls}>{signed && value > 0 ? '+' : ''}{formatBRL(value)}</span>
}

export function ErrorMessage({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

/** Wraps an async action with busy/error state for forms and buttons. */
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

export function confirmDelete(what: string): boolean {
  return window.confirm(`Excluir ${what}? Esta ação não pode ser desfeita.`)
}

export const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1)
