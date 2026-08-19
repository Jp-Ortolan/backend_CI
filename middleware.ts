import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Renova a sessão a cada requisição e barra o acesso ao painel sem login.
 *
 * O check-in público (/checkin e /api/checkin) fica de fora de propósito:
 * exigir cadastro do participante mataria a proposta do QR Code.
 */
export async function middleware(req: NextRequest) {
  let resposta = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(lista: { name: string; value: string; options: CookieOptions }[]) {
          lista.forEach(({ name, value }) => req.cookies.set(name, value));
          resposta = NextResponse.next({ request: req });
          lista.forEach(({ name, value, options }) =>
            resposta.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const caminho = req.nextUrl.pathname;

  const publico =
    caminho.startsWith('/checkin') ||
    caminho.startsWith('/api/checkin') ||
    caminho.startsWith('/login') ||
    caminho === '/';

  if (!data.user && !publico) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirecionar', caminho);
    return NextResponse.redirect(url);
  }

  return resposta;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
