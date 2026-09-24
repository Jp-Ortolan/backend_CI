/**
 * Define a senha do papel app_web — o usuário com que a APLICAÇÃO conecta.
 *
 *   npm run db:senha-app
 *
 * O papel nasce nas migrations sem senha e sem LOGIN, de propósito: assim a
 * senha nunca fica no repositório. Este script é o passo que falta, e é pedido
 * no terminal em vez de vir por argumento para não ficar no histórico do shell.
 *
 * Usa DATABASE_URL_ADMIN, o usuário dono do banco.
 */
import { createInterface } from 'node:readline';
import pg from 'pg';

const url = process.env.DATABASE_URL_ADMIN ?? '';
if (!url) {
  console.error('Defina DATABASE_URL_ADMIN (usuário dono do banco) antes de rodar.');
  process.exit(1);
}

/** @param {string} pergunta */
function perguntar(pergunta) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (r) => { rl.close(); resolve(r); }));
}

const senha = (await perguntar('Senha para o app_web: ')).trim();

if (senha.length < 12) {
  console.error('Use pelo menos 12 caracteres — esta senha protege o banco inteiro.');
  process.exit(1);
}

const ssl = /localhost|127\.0\.0\.1|host=\//.test(url) ? undefined : { rejectUnauthorized: false };
const c = new pg.Client({ connectionString: url, ssl });
await c.connect();

try {
  // Aspas simples dobradas: senha com apóstrofo não quebra o comando.
  await c.query(`alter role app_web login password '${senha.replace(/'/g, "''")}'`);
  const u = new URL(url);
  u.username = 'app_web';
  u.password = '<a senha que você acabou de digitar>';
  console.log('\napp_web pronto. A DATABASE_URL da aplicação fica assim:\n');
  console.log(`  ${decodeURIComponent(u.toString())}\n`);
} finally {
  await c.end();
}
