import { NextResponse } from 'next/server';

/**
 * Barreira rápida: quem não tem cookie de sessão nem chega a carregar o painel.
 *
 * O middleware roda no Edge, onde não há conexão com o PostgreSQL — então aqui
 * só se verifica a PRESENÇA do cookie, nunca a validade. A checagem real (token
 * existe, não expirou, usuário está ativo) acontece em exigirUsuario(), no
 * servidor. Um cookie forjado passa por aqui e morre lá.
 *
 * O check-in público fica de fora de propósito: exigir login do participante
 * mataria a proposta do QR Code.
 */
const ROTAS_PUBLICAS = [
  '/checkin',
  '/api/checkin',
  '/login',
  '/recuperar-senha',
  '/redefinir-senha',
  '/sem-permissao',
];

/**
 * @param {import('next/server').NextRequest} req
 */
export function middleware(req) {
  const caminho = req.nextUrl.pathname;
  const publico = caminho === '/' || ROTAS_PUBLICAS.some(r => caminho.startsWith(r));
  if (publico) return NextResponse.next();

  if (!req.cookies.get('sessao')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirecionar', caminho);
    url.searchParams.set('erro', 'sem_sessao');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
