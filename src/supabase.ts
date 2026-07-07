import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// A app nao quebra se as variaveis ainda nao estiverem configuradas:
// mostramos um aviso na tela de login em vez de tela branca.
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function edgeFunctionUrl(name: string) {
  return supabaseUrl ? `${supabaseUrl}/functions/v1/${name}` : '';
}

export type UserRole = 'admin' | 'borrower' | 'viewer';

export type Profile = {
  id: string;
  full_name: string;
  role: UserRole;
};
