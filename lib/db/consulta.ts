import type { PoolClient, QueryResultRow } from 'pg';
import { pool } from './pool';

/**
 * Consulta simples, fora de qualquer sessão de usuário.
 *
 * Como a aplicação conecta com o papel `app_web`, que não é dono das tabelas, o
 * RLS está valendo: sem declarar o usuário, esta função praticamente não enxerga
 * dado nenhum. Use-a só para chamar as funções públicas (check-in, login).
 */
export async function consulta<T extends QueryResultRow = QueryResultRow>(
  sql: string, valores: unknown[] = [],
): Promise<T[]> {
  const { rows } = await pool().query<T>(sql, valores);
  return rows;
}

export async function consultaUm<T extends QueryResultRow = QueryResultRow>(
  sql: string, valores: unknown[] = [],
): Promise<T | null> {
  const linhas = await consulta<T>(sql, valores);
  return linhas[0] ?? null;
}

export interface Transacao {
  consulta<T extends QueryResultRow = QueryResultRow>(
    sql: string, valores?: unknown[]): Promise<T[]>;
  consultaUm<T extends QueryResultRow = QueryResultRow>(
    sql: string, valores?: unknown[]): Promise<T | null>;
}

/**
 * Abre uma transação declarando QUEM é o usuário.
 *
 * O `set_config(..., true)` grava o id só para esta transação — duas
 * requisições simultâneas nunca enxergam o usuário uma da outra. É a partir
 * daqui que as políticas de RLS sabem o que liberar.
 *
 * Toda leitura ou escrita de dado do ecossistema DEVE passar por aqui.
 */
export async function comUsuario<T>(
  usuarioId: string,
  acao: (tx: Transacao) => Promise<T>,
): Promise<T> {
  const cliente: PoolClient = await pool().connect();
  try {
    await cliente.query('begin');
    await cliente.query('select set_config($1, $2, true)', ['app.usuario_id', usuarioId]);

    const tx: Transacao = {
      async consulta(sql, valores = []) {
        const { rows } = await cliente.query(sql, valores);
        return rows as never;
      },
      async consultaUm(sql, valores = []) {
        const { rows } = await cliente.query(sql, valores);
        return (rows[0] ?? null) as never;
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
