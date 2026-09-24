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

const url = (process.env.DATABASE_URL_ADMIN ?? '').trim();
if (!url) {
  console.error('Defina DATABASE_URL_ADMIN (usuário dono do banco) antes de rodar.');
  process.exit(1);
}

// Colar a URL com os < > do exemplo é fácil de fazer e o erro que sai depois
// não ajuda em nada ("ENOTFOUND base").
if (url.startsWith('<') || url.endsWith('>')) {
  console.error('A URL veio entre < e >. Tire os sinais: eles eram só marcador do exemplo.');
  process.exit(1);
}
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('DATABASE_URL_ADMIN precisa começar com postgresql://');
  process.exit(1);
}

/** @param {string} pergunta */
function perguntar(pergunta) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(pergunta, (r) => { rl.close(); resolve(r); }));
}

// Conectar ANTES de perguntar: senão uma URL errada faz a pessoa digitar a
// senha à toa, e três vezes seguidas.
const ssl = /localhost|127\.0\.0\.1|host=\//.test(url) ? undefined : { rejectUnauthorized: false };
const c = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });

try {
  await c.connect();
} catch (e) {
  console.error(`Não consegui conectar no banco: ${e.message}`);
  if (e.code === 'ENOTFOUND') console.error('Confira o endereço na DATABASE_URL_ADMIN.');
  if (e.code === '28P01') console.error('Senha do usuário dono recusada.');
  process.exit(1);
}

const senha = (await perguntar('Senha para o app_web: ')).trim();

if (senha.length < 12) {
  console.error('Use pelo menos 12 caracteres — esta senha protege o banco inteiro.');
  await c.end();
  process.exit(1);
}

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
