/**
 * Limite de requisições por IP nas rotas públicas (RNF14).
 *
 * Só o check-in precisa disto: as rotas do painel já exigem sessão, e sessão é
 * um limite melhor que IP. Aqui não há usuário nenhum, então o IP é o que
 * existe para agrupar.
 *
 * O contador mora no banco (migration 005) e não em memória — contador em
 * memória zera a cada deploy e não é compartilhado entre instâncias.
 */
import { consultaUm } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * Limites por ação, na janela indicada.
 *
 * A busca é mais apertada que o registro porque ela é a que expõe dado: cada
 * chamada devolve nome, instituição e cargo de até 5 pessoas. Registrar
 * presença, por outro lado, é o que o participante legítimo faz — e ele pode
 * errar o nome algumas vezes antes de acertar.
 */
const LIMITES = {
  buscar: { maximo: 20, janela: '1 minute' },
  registrar: { maximo: 10, janela: '1 minute' },
  consultar: { maximo: 60, janela: '1 minute' },
};

/**
 * Extrai o IP de quem chamou.
 *
 * Atrás de proxy (Railway, Vercel) o IP real vem em x-forwarded-for, que é uma
 * lista onde o PRIMEIRO endereço é o cliente. Vale lembrar que esse cabeçalho é
 * enviável por qualquer um: ele só é confiável porque o proxy da plataforma o
 * reescreve. Rodando sem proxy na frente, dá para forjar — e por isso este
 * limite é proteção contra abuso casual e script simples, não contra um
 * atacante determinado com muitos IPs.
 *
 * @param {import('next/server').NextRequest|Request} req
 * @returns {string}
 */
export function ipDaRequisicao(req) {
  const encaminhado = req.headers.get('x-forwarded-for');
  if (encaminhado) return encaminhado.split(',')[0].trim();
  return req.headers.get('x-real-ip')
    ?? /** @type {any} */ (req).ip
    ?? '';
}

/**
 * Conta a tentativa e recusa quando passar do limite.
 *
 * @param {keyof LIMITES} acao
 * @param {string} ip
 * @param {string|null} [token]
 * @returns {Promise<void>}
 */
export async function exigirDentroDoLimite(acao, ip, token = null) {
  const { maximo, janela } = LIMITES[acao];

  const linha = await consultaUm(
    'select checkin_contar_tentativa($1, $2, $3, $4::interval) as total',
    [ip, acao, token, janela],
  );
  const total = Number(linha?.total ?? 0);

  if (total > maximo) {
    throw new ErroDeNegocio('MUITAS_TENTATIVAS',
      'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.',
      { limite: maximo, janela });
  }
}

export const LIMITES_CONFIGURADOS = LIMITES;
