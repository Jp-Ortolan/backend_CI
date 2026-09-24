/**
 * Carrega banco/seed.sql — dados de exemplo para desenvolver e demonstrar.
 *
 *   npm run db:semear
 *
 * Recusa rodar se já houver instituição cadastrada: o seed é para banco vazio,
 * e rodá-lo sobre dado real duplicaria tudo.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { executarArquivo } from './lib/sql.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL_ADMIN ?? '';
if (!url) {
  console.error('Defina DATABASE_URL_ADMIN (usuário dono do banco) antes de rodar.');
  process.exit(1);
}

const ssl = /localhost|127\.0\.0\.1|host=\//.test(url) ? undefined : { rejectUnauthorized: false };
const c = new pg.Client({ connectionString: url, ssl });
await c.connect();

try {
  const { rows } = await c.query('select count(*)::int as n from instituicao');
  if (rows[0].n > 0 && process.argv[2] !== '--forcar') {
    console.error(`O banco já tem ${rows[0].n} instituição(ões). O seed é para banco vazio.`);
    console.error('Se for mesmo o que você quer, rode: npm run db:semear -- --forcar');
    process.exit(1);
  }
  await executarArquivo(c, await readFile(path.join(RAIZ, 'banco', 'seed.sql'), 'utf8'));
  console.log('seed aplicado.');
} finally {
  await c.end();
}
