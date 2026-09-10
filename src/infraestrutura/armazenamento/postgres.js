/**
 * Adaptador de armazenamento — PostgreSQL.
 *
 * Guarda os bytes em documento_conteudo, dentro da mesma transação que grava o
 * metadado. Ver a decisão e o custo dela no cabeçalho da migration 004.
 */

/**
 * @typedef {object} Alvo
 * @property {string} documentoId
 * @property {string} caminho
 * @property {Buffer} [conteudo]
 */

/**
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {Alvo} alvo
 * @returns {Promise<void>}
 */
export async function salvar(tx, { documentoId, conteudo }) {
  await tx.consulta(
    'insert into documento_conteudo (documento_id, conteudo) values ($1, $2)',
    [documentoId, conteudo],
  );
}

/**
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {Alvo} alvo
 * @returns {Promise<Buffer|null>}
 */
export async function ler(tx, { documentoId }) {
  const linha = await tx.consultaUm(
    'select conteudo from documento_conteudo where documento_id = $1', [documentoId],
  );
  // O driver devolve bytea como Buffer.
  return linha ? linha.conteudo : null;
}

/**
 * @param {import('@/infraestrutura/banco/consulta.js').Transacao} tx
 * @param {Alvo} alvo
 * @returns {Promise<void>}
 */
export async function remover(tx, { documentoId }) {
  // Na prática o "on delete cascade" de documento_conteudo já apaga junto com o
  // documento. Este método existe para o caso de o adaptador mudar: com S3, o
  // banco não tem como apagar o objeto sozinho.
  await tx.consulta('delete from documento_conteudo where documento_id = $1', [documentoId]);
}

export const nome = 'postgres';
