/**
 * Recria um banco descartável, aplica migrations e seed, e roda os testes SQL.
 *
 *   npm run db:testar
 *
 * POR QUE EM NODE E NÃO EM BASH
 * O `testar-banco.sh` faz a mesma coisa, mas precisa de `bash` e de `psql` no
 * PATH. Metade da equipe está no Windows, onde o PowerShell não roda `.sh` e o
 * `psql` só aparece no PATH se a pessoa marcou a opção certa no instalador.
 * Este arquivo usa o `pg`, que já é dependência do projeto — se `npm install`
 * funcionou, isto funciona.
 *
 * VARIÁVEIS
 *   DATABASE_URL_ADMIN   usuário DONO do banco (obrigatória)
 *   BANCO                nome do banco descartável (padrão: ecossistema_teste)
 *
 * No PowerShell:
 *   $env:DATABASE_URL_ADMIN = "postgresql://postgres:senha@localhost:5432/postgres"
 *   npm run db:testar
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { executarArquivo } from './lib/sql.mjs';

const { Client } = pg;
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BANCO = process.env.BANCO ?? 'ecossistema_teste';

const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL ?? '';
if (!URL_ADMIN) {
  console.error('Defina DATABASE_URL_ADMIN (usuário dono do banco) antes de rodar.');
  console.error('PowerShell: $env:DATABASE_URL_ADMIN = "postgresql://postgres:SENHA@localhost:5432/postgres"');
  process.exit(1);
}

/** Troca o nome do banco na URL, mantendo o resto. */
function comBanco(url, nome) {
  const u = new URL(url);
  u.pathname = `/${nome}`;
  return u.toString();
}

const ssl = /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(URL_ADMIN)
  ? undefined : { rejectUnauthorized: false };

/**
 * Abre conexão, roda a ação e fecha — mesmo se a ação falhar.
 * Sem o `finally`, um erro no meio deixaria o processo pendurado.
 */
async function conectando(url, acao) {
  const c = new Client({ connectionString: url, ssl });
  await c.connect();
  try {
    return await acao(c);
  } finally {
    await c.end();
  }
}

const verde = (t) => `[32m${t}[0m`;
const vermelho = (t) => `[31m${t}[0m`;
const cinza = (t) => `[90m${t}[0m`;

async function principal() {
  console.log(`==> recriando o banco ${BANCO}`);
  await conectando(comBanco(URL_ADMIN, 'postgres'), async (c) => {
    // Derruba conexões abertas: sem isso, um `npm run dev` esquecido rodando
    // contra este banco faz o DROP travar esperando para sempre.
    await c.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`, [BANCO],
    );
    await c.query(`drop database if exists ${BANCO}`);
    await c.query(`create database ${BANCO}`);
  });

  const url = comBanco(URL_ADMIN, BANCO);
  let falhou = false;

  await conectando(url, async (c) => {
    console.log('==> aplicando migrations');
    const dir = path.join(RAIZ, 'banco', 'migrations');
    for (const nome of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      process.stdout.write(`    ${nome} `);
      await executarArquivo(c, await readFile(path.join(dir, nome), 'utf8'));
      console.log(verde('ok'));
    }

    console.log('==> aplicando seed');
    await executarArquivo(c, await readFile(path.join(RAIZ, 'banco', 'seed.sql'), 'utf8'));
  });

  console.log('==> rodando os testes');
  const dirTestes = path.join(RAIZ, 'testes', 'banco');
  const arquivos = (await readdir(dirTestes)).filter((f) => f.endsWith('.sql')).sort();

  let totalOk = 0;

  for (const nome of arquivos) {
    console.log('');
    console.log(cinza(`--- ${nome}`));

    // Conexão nova por arquivo: um erro deixa a transação abortada, e as
    // consultas seguintes falhariam por tabela de dominó em vez de por defeito
    // próprio — escondendo qual teste realmente quebrou.
    const c = new Client({ connectionString: url, ssl });
    let ok = 0;

    // As asserções dos testes falam por `raise notice`. É preciso escutar o
    // evento; o resultado da consulta não traz essas mensagens.
    c.on('notice', (n) => {
      const msg = (n.message ?? '').trim();
      if (!msg) return;
      if (msg.startsWith('OK')) { ok += 1; console.log(`  ${verde('✓')} ${msg.slice(2).trim()}`); }
      else if (!msg.startsWith('==')) console.log(cinza(`    ${msg}`));
    });

    await c.connect();
    try {
      await executarArquivo(c, await readFile(path.join(dirTestes, nome), 'utf8'));
      totalOk += ok;
    } catch (e) {
      falhou = true;
      console.log(`  ${vermelho('✗ FALHOU')}: ${e.message}`);
      if (e.hint) console.log(cinza(`    ${e.hint}`));
    } finally {
      await c.end();
    }
  }

  // ------------------------------------------------------------------------
  // Deixa o banco pronto para os testes de integração, que conectam como
  // app_web (não-dono) para o RLS valer de verdade. O papel nasce sem senha e
  // sem LOGIN de propósito — em produção quem define isso é o DevOps, com um
  // comando único, para a senha não ficar no repositório.
  //
  // Aqui é seguro fazer automaticamente porque `alter role` vale para o
  // cluster inteiro, e este script só roda contra banco local descartável.
  // Fora de localhost, ele não mexe: imprime o comando e sai do caminho.
  // ------------------------------------------------------------------------
  const local = /localhost|127\.0\.0\.1/.test(URL_ADMIN);
  const senhaApp = process.env.SENHA_APP_WEB ?? 'app_web';

  if (local) {
    await conectando(url, (c) =>
      c.query(`alter role app_web login password '${senhaApp}'`));
  }

  const urlApp = comBanco(URL_ADMIN, BANCO)
    .replace(/\/\/[^@]*@/, `//app_web:${senhaApp}@`);

  console.log('');
  console.log(cinza('Para rodar os testes de integração neste banco:'));
  if (!local) {
    console.log(cinza(`  alter role app_web login password '<senha>';   (falta rodar)`));
  }
  console.log(cinza('  PowerShell:'));
  console.log(cinza(`    $env:DATABASE_URL = "${urlApp}"`));
  console.log(cinza(`    $env:DATABASE_URL_ADMIN = "${comBanco(URL_ADMIN, BANCO)}"`));
  console.log(cinza('    npm run test:integracao'));

  console.log('');
  if (falhou) {
    console.log(vermelho(`==> ALGUM TESTE FALHOU (${totalOk} passaram antes disso)`));
    process.exit(1);
  }
  console.log(verde(`==> TUDO PASSOU — ${totalOk} testes`));
}

principal().catch((e) => {
  console.error(vermelho(`\n==> erro: ${e.message}`));
  if (e.code === 'ECONNREFUSED') {
    console.error('    O PostgreSQL está rodando? Confira host e porta na DATABASE_URL_ADMIN.');
  }
  if (e.code === '28P01') {
    console.error('    Senha recusada. Confira o usuário e a senha na DATABASE_URL_ADMIN.');
  }
  process.exit(1);
});
