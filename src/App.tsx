import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './data/AuthContext'
import { DataProvider, useData } from './data/DataContext'
import { isSupabaseConfigured } from './data/supabase'
import { CardsPage } from './pages/Cards'
import { DashboardPage } from './pages/Dashboard'
import { ExpensesPage } from './pages/Expenses'
import { IncomePage } from './pages/Income'
import { LoginPage } from './pages/Login'
import { SimulatorPage } from './pages/Simulator'

const NAV = [
  { to: '/', label: 'Painel', icon: '◎', end: true },
  { to: '/despesas', label: 'Despesas', icon: '↓' },
  { to: '/simular', label: 'Simular', icon: '?' },
  { to: '/renda', label: 'Renda', icon: '↑' },
  { to: '/cartoes', label: 'Cartões', icon: '▭' },
]

export function App() {
  if (!isSupabaseConfigured) return <NotConfigured />
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

function AuthGate() {
  const { session, loading } = useAuth()
  if (loading) return <div className="center-screen">Carregando…</div>
  if (!session) return <LoginPage />
  return (
    <DataProvider userId={session.user.id}>
      <Shell email={session.user.email ?? ''} />
    </DataProvider>
  )
}

function Shell({ email }: { email: string }) {
  const { signOut } = useAuth()
  const { data, error, reload } = useData()

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">PlanejaBolso</span>
        <nav className="nav-desktop">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-user">
          <span className="user-email" title={email}>{email}</span>
          <button className="link-button" onClick={signOut}>Sair</button>
        </div>
      </header>

      <main className="content">
        {error && (
          <div className="error-banner">
            Não foi possível carregar seus dados: {error}{' '}
            <button className="link-button" onClick={reload}>Tentar novamente</button>
          </div>
        )}
        {!data ? (
          !error && <div className="center-screen">Carregando seus dados…</div>
        ) : (
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/despesas" element={<ExpensesPage />} />
            <Route path="/renda" element={<IncomePage />} />
            <Route path="/cartoes" element={<CardsPage />} />
            <Route path="/simular" element={<SimulatorPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>

      <nav className="nav-mobile">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <span className="nav-icon" aria-hidden>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="center-screen">
      <div className="card narrow">
        <h1>Configuração necessária</h1>
        <p>
          Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> em um arquivo <code>.env.local</code>{' '}
          (veja <code>.env.example</code>) ou nos secrets do repositório para o deploy.
        </p>
      </div>
    </div>
  )
}
