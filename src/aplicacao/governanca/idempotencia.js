/**
 * chaveOperacao do contrato: repetir a mesma operação (o front reenvia depois
 * de uma falha de rede, ou sincroniza presenças guardadas offline) não
 * duplica nada.
 *
 *   mesma chave + mesmo conteúdo  → devolve a resposta gravada
 *   mesma chave + outro conteúdo  → 409 OPERACAO_REPETIDA_DIFERENTE
 *
 * A chave é reservada na MESMA transação da operação: se a operação falha, a
 * reserva some junto, e a nova tentativa executa de verdade. Duas tentativas
 * simultâneas esperam uma pela outra no índice único.
 */
import { createHash } from 'node:crypto';
import { ErroDeNegocio } from '@/dominio/erros.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JSON com as chaves em ordem: o mesmo conteúdo dá o mesmo hash. */
function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * @template T
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {{ id: string }} u
 * @param {string|undefined|null} chave
 * @param {string} escopo   ex.: "presenca:<reuniaoId>"
 * @param {Record<string, unknown>} conteudo  o corpo, sem a chave
 * @param {() => Promise<T>} executar
 * @returns {Promise<T>}
 */
export async function umaVez(tx, u, chave, escopo, conteudo, executar) {
  if (chave === undefined || chave === null || chave === '') return executar();
  if (!UUID.test(String(chave))) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'chaveOperacao precisa ser um UUID.',
      { campos: [{ campo: 'chaveOperacao', mensagem: 'UUID inválido.' }] });
  }
  const hash = createHash('sha256').update(`${escopo}|${canonico(conteudo)}`).digest('hex');

  const reservada = await tx.consultaUm(
    `insert into operacao_idempotente (chave, usuario_id, escopo, hash)
     values ($1, $2, $3, $4) on conflict do nothing returning chave`,
    [chave, u.id, escopo, hash]);

  if (!reservada) {
    const anterior = await tx.consultaUm(
      'select escopo, hash, resposta from operacao_idempotente where chave = $1 and usuario_id = $2',
      [chave, u.id]);
    if (!anterior || anterior.hash !== hash || anterior.escopo !== escopo) {
      throw new ErroDeNegocio('OPERACAO_REPETIDA_DIFERENTE',
        'Esta operação já foi registrada com outro conteúdo. Revise os dados e envie como um novo registro.');
    }
    return /** @type {T} */ ({ ...(anterior.resposta ?? {}), repetida: true });
  }

  const resposta = await executar();
  await tx.consulta('update operacao_idempotente set resposta = $3 where chave = $1 and usuario_id = $2',
    [chave, u.id, JSON.stringify(resposta ?? {})]);
  return resposta;
}
