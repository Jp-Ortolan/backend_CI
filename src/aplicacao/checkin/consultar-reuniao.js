/**
 * CASO DE USO — Abrir a página de check-in pelo QR Code (RF27).
 *
 * Toda a regra de "esta reunião aceita presença agora?" está na função
 * checkin_reuniao, dentro do banco. Aqui só se traduz o resultado.
 */
import { consultaUm } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';

/**
 * @typedef {object} ReuniaoPublica
 * @property {string} titulo
 * @property {string} data
 * @property {string|null} hora_inicio
 * @property {string|null} local
 * @property {string} status
 * @property {boolean} aberto
 */

/**
 * @param {string} token  o qr_token que veio na URL
 * @returns {Promise<{ reuniao: object, checkinAberto: boolean }>}
 */
export async function consultarReuniao(token) {
  /** @type {ReuniaoPublica|null} */
  const r = await consultaUm('select * from checkin_reuniao($1)', [token]);

  if (!r) {
    throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA',
      'Não encontramos esta reunião. Confira o QR Code.');
  }

  return {
    reuniao: { titulo: r.titulo, data: r.data, horaInicio: r.hora_inicio, local: r.local },
    checkinAberto: r.aberto,
  };
}
