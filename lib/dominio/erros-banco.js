import { ErroDeNegocio } from './erros.js';

/**
 * As funções de check-in no banco sinalizam problema levantando exceção com
 * uma palavra-chave. Aqui essa palavra vira o código estável do contrato de API
 * e a mensagem em português que o participante lê.
 *
 * Ver docs/04-contrato-de-api.md
 *
 * @type {Record<string, [import('./erros.js').CodigoErro, string]>}
 */
const MAPA = {
  REUNIAO_NAO_ENCONTRADA: ['REUNIAO_NAO_ENCONTRADA',
    'Não encontramos esta reunião. Confira o QR Code.'],
  REUNIAO_CANCELADA: ['REUNIAO_CANCELADA', 'Esta reunião foi cancelada.'],
  CHECKIN_FECHADO: ['CHECKIN_FECHADO',
    'O registro de presença desta reunião não está aberto neste momento.'],
  VINCULO_INVALIDO: ['VINCULO_INVALIDO',
    'Não encontramos um vínculo institucional válido para você nesta data.'],
  PESSOA_NAO_ENCONTRADA: ['VINCULO_INVALIDO', 'Participante não encontrado.'],
  NOME_INVALIDO: ['DADOS_INVALIDOS', 'Informe seu nome completo.'],
  TERMO_CURTO: ['DADOS_INVALIDOS', 'Digite ao menos 3 letras do nome.'],
};

/**
 * Traduz a exceção do banco. Se não for uma das conhecidas, repassa como está.
 *
 * @param {unknown} e
 * @returns {never}
 */
export function traduzirErroDoBanco(e) {
  const msg = (e && typeof e === 'object' && 'message' in e ? String(e.message) : '') ?? '';
  for (const [chave, [codigo, texto]] of Object.entries(MAPA)) {
    if (msg.includes(chave)) throw new ErroDeNegocio(codigo, texto);
  }
  throw e;
}
