'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente do navegador. Usa a anon key — quem decide o que este usuário
 * enxerga é o RLS, não o front-end.
 */
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
