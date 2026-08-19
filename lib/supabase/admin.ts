import { createClient } from '@supabase/supabase-js';

/**
 * ATENÇÃO — cliente com service role. IGNORA TODO O RLS.
 *
 * Só pode ser importado em código que roda no servidor: Route Handler,
 * Server Action ou Edge Function. Se este arquivo entrar na árvore de um
 * componente com "use client", a chave vai para o navegador e todo o controle
 * de acesso do sistema deixa de valer.
 *
 * Uso previsto: apenas o fluxo público de check-in, que não tem sessão de
 * usuário e por isso não consegue passar pelo RLS.
 */
export function criarClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chave) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar definidas.',
    );
  }

  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
