import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Public client configuration. These values are embedded in the static build and are
// not secret: authorization is enforced by Row Level Security in the database.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && key)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, key!, {
      // PKCE puts the auth code in the query string, which does not clash with hash routing.
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}
