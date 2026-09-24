import { NextResponse } from 'next/server';
import { urlDoFront } from '@/infraestrutura/http/front.js';

/**
 * Duas coisas antes de qualquer rota: CORS e a conferência do cookie.
 *
 * CORS existe porque o front é outro projeto, em outro endereço — sem estes
 * cabeçalhos o navegador nem entrega a resposta a ele. Só a origem configurada
 * em URL_FRONTEND é liberada, e com credenciais, para o cookie de sessão viajar.
 *
 * O cookie é só conferido pela PRESENÇA: no Edge não há conexão com o Postgres.
 * A validade é checada no servidor, em usuarioAtual() — cookie forjado passa
 * por aqui e morre lá. A resposta é 401 em JSON, não redirecionamento: quem
 * chama é o front, que precisa do código para levar o usuário ao login.
 */
const ROTAS_PUBLICAS = [
  // Check-in por QR Code: exigir login do participante mataria a proposta.
  '/api/checkin',
  // Verificador de saúde não faz login, e a rota não devolve dado do ecossistema.
  '/api/saude',
  // Entrar e recuperar senha: são elas que criam a sessão.
  '/api/sessao',
  '/api/senha',
];

/**
 * @param {NextResponse} resposta
 * @param {string} origem
 */
function comCors(resposta, origem) {
  if (origem) {
    resposta.headers.set('Access-Control-Allow-Origin', origem);
    resposta.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  resposta.headers.set('Vary', 'Origin');
  return resposta;
}

/**
 * @param {import('next/server').NextRequest} req
 */
export function middleware(req) {
  const front = urlDoFront();
  const origem = req.headers.get('origin') === front ? front : '';

  // Preflight: o navegador pergunta antes de mandar POST/PATCH/DELETE com cookie.
  if (req.method === 'OPTIONS') {
    const r = new NextResponse(null, { status: 204 });
    r.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    r.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    r.headers.set('Access-Control-Max-Age', '86400');
    return comCors(r, origem);
  }

  const caminho = req.nextUrl.pathname;
  const publica = ROTAS_PUBLICAS.some((r) => caminho.startsWith(r));

  if (!publica && !req.cookies.get('sessao')) {
    return comCors(NextResponse.json(
      { erro: { codigo: 'NAO_AUTENTICADO', mensagem: 'É preciso estar autenticado.' } },
      { status: 401 },
    ), origem);
  }

  return comCors(NextResponse.next(), origem);
}

export const config = {
  matcher: ['/api/:path*'],
};
