import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Cliente de servidor com a sessão do usuário (Server Component, Server Action
 * e Route Handler autenticado). Continua sujeito ao RLS.
 */
export function criarClienteServidor() {
  const armazem = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return armazem.getAll();
        },
        setAll(lista: { name: string; value: string; options: CookieOptions }[]) {
          try {
            lista.forEach(({ name, value, options }) =>
              armazem.set(name, value, options));
          } catch {
            // Server Component não pode escrever cookie. O middleware já
            // renova a sessão, então aqui é seguro ignorar.
          }
        },
      },
    },
  );
}
