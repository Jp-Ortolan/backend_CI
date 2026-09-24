import { pool } from './pool.js';

/**
 * Consulta fora de sessão de usuário. Com o RLS valendo, enxerga quase nada:
 * use só para as funções públicas (check-in, login).
 *
 * @param {string} sql
 * @param {unknown[]} [valores]
 * @returns {Promise<any[]>}
 */
export async function consulta(sql, valores = []) {
  const { rows } = await pool().query(sql, valores);
  return rows;
}

/**
 * Igual à anterior, mas devolve só a primeira linha (ou null).
 *
 * @param {string} sql
 * @param {unknown[]} [valores]
 * @returns {Promise<any|null>}
 */
export async function consultaUm(sql, valores = []) {
  const linhas = await consulta(sql, valores);
  return linhas[0] ?? null;
}

/**
 * O objeto entregue ao callback de comUsuario().
 *
 * @typedef {object} Transacao
 * @property {(sql: string, valores?: unknown[]) => Promise<any[]>} consulta
 * @property {(sql: string, valores?: unknown[]) => Promise<any|null>} consultaUm
 */

/**
 * Abre uma transação declarando quem é o usuário — é daqui que o RLS sabe o que
 * liberar. Toda leitura ou escrita de dado do ecossistema passa por aqui.
 *
 * @template T
 * @param {string} usuarioId
 * @param {(tx: Transacao) => Promise<T>} acao
 * @returns {Promise<T>}
 */
export async function comUsuario(usuarioId, acao) {
  const cliente = await pool().connect();
  try {
    await cliente.query('begin');
    await cliente.query('select set_config($1, $2, true)', ['app.usuario_id', usuarioId]);

    /** @type {Transacao} */
    const tx = {
      async consulta(sql, valores = []) {
        const { rows } = await cliente.query(sql, valores);
        return rows;
      },
      async consultaUm(sql, valores = []) {
        const { rows } = await cliente.query(sql, valores);
        return rows[0] ?? null;
      },
    };

    const resultado = await acao(tx);
    await cliente.query('commit');
    return resultado;
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}
