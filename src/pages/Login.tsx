import { useState, type FormEvent } from 'react'
import { ErrorMessage, Field, useAction } from '../components/ui'
import { useAuth } from '../data/AuthContext'

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const { busy, error, setError, run } = useAction()

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setInfo(null)
    await run(async () => {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        const { needsConfirmation } = await signUp(email, password)
        if (needsConfirmation) {
          setInfo('Conta criada! Confirme seu e-mail pelo link enviado e depois entre.')
          setMode('signin')
        }
      }
    })
  }

  return (
    <div className="center-screen">
      <form className="card narrow login" onSubmit={onSubmit}>
        <h1 className="brand">PlanejaBolso</h1>
        <p className="muted">Planeje o mês, veja quanto da sua renda já está comprometida e simule compras antes de fazê-las.</p>

        <div className="segmented" role="tablist">
          <button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(null) }}>
            Entrar
          </button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(null) }}>
            Criar conta
          </button>
        </div>

        <Field label="E-mail">
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha" hint={mode === 'signup' ? 'Mínimo de 6 caracteres' : undefined}>
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <ErrorMessage error={error} />
        {info && <p className="info">{info}</p>}

        <button className="button primary block" disabled={busy}>
          {busy ? 'Aguarde…' : mode === 'signin' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>
    </div>
  )
}
