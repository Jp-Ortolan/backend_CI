/**
 * Aplica as migrations que ainda não rodaram, em ordem, uma vez cada.
 *
 *   npm run db:migrar
 *
 * POR QUE EM NODE E NÃO EM BASH
 * É este o comando que roda no deploy do Railway, e a imagem de lá não tem
 * bash nem psql. O `pg` já é dependência do projeto.
 *
 * Cada arquivo roda dentro de uma transação junto com o registro na tabela de
 * controle: ou a migration inteira entra e fica marcada, ou nada entra. Sem
 * isso, uma falha no meio deixaria metade aplicada e não marcada, e a próxima
 * tentativa rodaria a primeira metade de novo.
 *
 * Usa DATABASE_URL_ADMIN — o usuário DONO do banco. A aplicação nunca usa esse
 * usuário: ela conecta como app_web, que não é dono, para o RLS valer.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { executarArquivo } from './lib/sql.mjs';

const { Client } = pg;
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL ?? '';
if (!URL_ADMIN) {
  console.error('Defina DATABASE_URL_ADMIN (usuário dono do banco) antes de rodar.');
  process.exit(1);
}

const ssl = /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(URL_ADMIN)
  ? undefined : { rejectUnauthorized: false };

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const cinza = (t) => `\x1b[90m${t}\x1b[0m`;
const vermelho = (t) => `\x1b[31m${t}\x1b[0m`;

async function principal() {
  const c = new Client({ connectionString: URL_ADMIN, ssl });
  await c.connect();

  try {
    await c.query(`create table if not exists migration_aplicada (
      arquivo     text primary key,
      aplicada_em timestamptz not null default now()
    )`);

    const dir = path.join(RAIZ, 'banco', 'migrations');
    const arquivos = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

    const { rows } = await c.query('select arquivo from migration_aplicada');
    const jaAplicadas = new Set(rows.map((l) => l.arquivo));

    let aplicadas = 0;
    for (const nome of arquivos) {
      if (jaAplicadas.has(nome)) {
        console.log(cinza(`  = ${nome}`));
        continue;
      }

      console.log(`  + ${nome}`);
      const sql = await readFile(path.join(dir, nome), 'utf8');

      await c.query('begin');
      try {
        await executarArquivo(c, sql);
        await c.query('insert into migration_aplicada (arquivo) values ($1)', [nome]);
        await c.query('commit');
        aplicadas += 1;
      } catch (e) {
        await c.query('rollback');
        throw new Error(`${nome}: ${e.message}`, { cause: e });
      }
    }

    console.log('');
    console.log(verde(`==> ${aplicadas} migration(s) aplicada(s)`));
  } finally {
    await c.end();
  }
}

principal().catch((e) => {
  console.error(vermelho(`\n==> erro: ${e.message}`));
  if (e.code === 'ECONNREFUSED') {
    console.error('    O banco está de pé? Confira host e porta na DATABASE_URL_ADMIN.');
  }
  if (e.code === '28P01') console.error('    Senha recusada.');
  process.exit(1);
});
