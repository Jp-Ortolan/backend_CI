/**
 * CASO DE USO — Achar o participante pelo nome, na tela de check-in (RF28).
 */
import { consulta } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';

/**
 * @typedef {object} Candidato
 * @property {string} pessoa_id
 * @property {string} nome
 * @property {string} instituicao
 * @property {string|null} cargo
 * @property {string} vinculo_id
 */

/**
 * A função do banco devolve no máximo 5 resultados e exige 3 caracteres: os
 * dois limites dificultam varrer a base pelos nomes.
 *
 * @param {string} token
 * @param {string} termo
 * @returns {Promise<{ resultados: object[] }>}
 */
export async function buscarParticipante(token, termo) {
  const busca = (termo ?? '').trim();
  if (busca.length < 3) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Digite ao menos 3 letras do nome.');
  }

  /** @type {Candidato[]} */
  let linhas = [];
  try {
    linhas = await consulta('select * from checkin_buscar($1, $2)', [token, busca]);
  } catch (e) { traduzirErroDoBanco(e); }

  return {
    resultados: linhas.map(l => ({
      pessoaId: l.pessoa_id,
      nome: l.nome,
      instituicao: l.instituicao,
      cargo: l.cargo,
      vinculoId: l.vinculo_id,
    })),
  };
}
