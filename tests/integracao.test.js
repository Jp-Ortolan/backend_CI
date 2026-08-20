/**
 * Testes de integração da autenticação — rodam contra um PostgreSQL de verdade.
 *
 *   DATABASE_URL=postgresql://... npm run test:integracao
 *
 * Sem DATABASE_URL definida, o arquivo é pulado: assim o `npm test` continua
 * funcionando na máquina de quem ainda não subiu o banco.
 *
 * O que estes testes provam, e os testes SQL sozinhos não provam: que o hash
 * Argon2id conferido pelo Node casa com o que está gravado, que a sessão
 * criada é a mesma que é lida depois, e que o RLS enxerga o usuário certo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { gerarHash, conferir } from '../lib/auth/senha.js';
import { gerarToken, hashToken } from '../lib/auth/tokens.js';

const { Client } = pg;

const URL = process.env.DATABASE_URL ?? '';
const rodar = URL.length > 0;

/** @type {import('pg').Client} */
let db;
const EMAIL = `teste.integracao.${Date.now()}@centroinovacao.br`;
const SENHA = 'senhaDeTeste123';
let usuarioId = '';

before(async () => {
  if (!rodar) return;
  db = new Client({
    connectionString: URL,
    ssl: /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(URL)
      ? undefined : { rejectUnauthorized: false },
  });
  await db.connect();
  const { rows } = await db.query(
    `insert into usuario (nome, email, papel, senha_hash)
     values ('Teste Integração', $1, 'gestor', $2) returning id`,
    [EMAIL, await gerarHash(SENHA)],
  );
  usuarioId = rows[0].id;
});

after(async () => {
  if (!rodar) return;
  await db.query('delete from usuario where id = $1', [usuarioId]);
  await db.end();
});

test('senha correta é aceita e senha errada é recusada', { skip: !rodar }, async () => {
  const { rows } = await db.query(
    'select senha_hash from auth_credenciais($1)', [EMAIL],
  );
  const hashSalvo = rows[0].senha_hash;

  assert.equal(await conferir(SENHA, hashSalvo), true, 'a senha correta deveria passar');
  assert.equal(await conferir('outraCoisa', hashSalvo), false, 'senha errada não pode passar');
  assert.equal(await conferir(SENHA, null), false, 'sem hash não se autentica');
});

test('e-mail inexistente não devolve credencial', { skip: !rodar }, async () => {
  const { rows } = await db.query(
    'select * from auth_credenciais($1)', ['ninguem.aqui@exemplo.br'],
  );
  assert.equal(rows.length, 0);
});

test('sessão criada é lida de volta e some ao ser encerrada', { skip: !rodar }, async () => {
  const token = gerarToken();
  const expira = new Date(Date.now() + 3600_000).toISOString();

  await db.query('select auth_criar_sessao($1, $2, $3, $4, $5)',
    [usuarioId, hashToken(token), expira, '127.0.0.1', 'teste']);

  const lida = await db.query('select id, papel from auth_ler_sessao($1)', [hashToken(token)]);
  assert.equal(lida.rows.length, 1, 'a sessão recém-criada deveria ser encontrada');
  assert.equal(lida.rows[0].id, usuarioId);
  assert.equal(lida.rows[0].papel, 'gestor');

  await db.query('select auth_encerrar_sessao($1)', [hashToken(token)]);
  const depois = await db.query('select * from auth_ler_sessao($1)', [hashToken(token)]);
  assert.equal(depois.rows.length, 0, 'a sessão encerrada não pode mais ser lida');
});

test('sessão expirada não é aceita', { skip: !rodar }, async () => {
  const token = gerarToken();
  const passado = new Date(Date.now() - 1000).toISOString();
  // criada_em precisa ser anterior à expiração, por causa da constraint
  await db.query(
    `insert into sessao (token_hash, usuario_id, criada_em, expira_em)
     values ($1, $2, now() - interval '2 hours', $3)`,
    [hashToken(token), usuarioId, passado],
  );
  const { rows } = await db.query('select * from auth_ler_sessao($1)', [hashToken(token)]);
  assert.equal(rows.length, 0, 'sessão vencida não pode autenticar');
  await db.query('delete from sessao where token_hash = $1', [hashToken(token)]);
});

test('trocar a senha derruba as sessões abertas', { skip: !rodar }, async () => {
  const token = gerarToken();
  await db.query('select auth_criar_sessao($1, $2, $3)',
    [usuarioId, hashToken(token), new Date(Date.now() + 3600_000).toISOString()]);

  assert.equal((await db.query('select * from auth_ler_sessao($1)', [hashToken(token)])).rows.length, 1);

  await db.query('select auth_definir_senha($1, $2)', [usuarioId, await gerarHash('novaSenha456')]);

  const depois = await db.query('select * from auth_ler_sessao($1)', [hashToken(token)]);
  assert.equal(depois.rows.length, 0, 'sessão antiga deveria cair ao trocar a senha');
});

test('token de recuperação só serve uma vez', { skip: !rodar }, async () => {
  const token = gerarToken();
  await db.query('select auth_criar_token_recuperacao($1, $2, $3)',
    [EMAIL, hashToken(token), new Date(Date.now() + 3600_000).toISOString()]);

  const primeira = await db.query('select auth_usar_token_recuperacao($1) as id', [hashToken(token)]);
  assert.equal(primeira.rows[0].id, usuarioId, 'o primeiro uso deveria devolver o dono');

  const segunda = await db.query('select auth_usar_token_recuperacao($1) as id', [hashToken(token)]);
  assert.equal(segunda.rows[0].id, null, 'o segundo uso não pode valer');
});

test('recuperação para e-mail inexistente não cria token nem falha',
  { skip: !rodar }, async () => {
  const token = gerarToken();
  await db.query('select auth_criar_token_recuperacao($1, $2, $3)',
    ['ninguem.aqui@exemplo.br', hashToken(token), new Date(Date.now() + 3600_000).toISOString()]);

  const { rows } = await db.query('select auth_usar_token_recuperacao($1) as id', [hashToken(token)]);
  assert.equal(rows[0].id, null, 'não deveria existir token para e-mail inexistente');
});

test('RLS enxerga o usuário declarado na transação', { skip: !rodar }, async () => {
  await db.query('begin');
  await db.query('set local role app_web');
  await db.query("select set_config('app.usuario_id', $1, true)", [usuarioId]);

  const { rows } = await db.query('select papel_atual() as papel');
  assert.equal(rows[0].papel, 'gestor');

  await db.query('rollback');
});
