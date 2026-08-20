import { NextRequest, NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/servidor';

/**
 * Troca o código do link enviado por e-mail por uma sessão.
 * É por aqui que passa a recuperação de senha (RF02) e o convite de novo usuário.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const codigo = searchParams.get('code');
  const proximo = searchParams.get('proximo') ?? '/dashboard';

  if (!codigo) {
    return NextResponse.redirect(`${origin}/login?erro=link_invalido`);
  }

  const supabase = criarClienteServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(codigo);

  if (error) {
    return NextResponse.redirect(`${origin}/login?erro=link_expirado`);
  }
  return NextResponse.redirect(`${origin}${proximo}`);
}
