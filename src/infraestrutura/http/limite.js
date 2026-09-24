/**
 * Limite de requisições por IP nas rotas públicas (RNF14).
 * Só o check-in precisa: o painel já exige sessão, que é limite melhor que IP.
 * O contador mora no banco (migration 005), não em memória.
 */
import { consultaUm } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * Limites por ação, na janela indicada.
 * A busca é mais apertada porque devolve nome, instituição e cargo de outras pessoas.
 */
const LIMITES = {
  buscar: { maximo: 20, janela: '1 minute' },
  registrar: { maximo: 10, janela: '1 minute' },
  consultar: { maximo: 60, janela: '1 minute' },
};

/**
 * IP de quem chamou. Atrás de proxy vem em x-forwarded-for, cujo primeiro
 * endereço é o cliente. Sem proxy na frente dá para forjar: isto barra abuso
 * casual, não atacante determinado.
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
