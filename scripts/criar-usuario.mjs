#!/usr/bin/env node
/**
 * Cria um usuário do sistema.
 *
 *   node scripts/criar-usuario.mjs "Ana Gestora" ana@centroinovacao.br admin
 *
 * A senha é pedida no terminal e não aparece na tela — passar senha por
 * argumento a deixaria gravada no histórico do shell.
 *
 * Usa DATABASE_URL_ADMIN, porque criar usuário é ato de administração do banco,
 * não da aplicação.
 */
import { createInterface } from 'node:readline';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const [nome, email, papel = 'leitura'] = process.argv.slice(2);

if (!nome || !email) {
  console.error('Uso: node scripts/criar-usuario.mjs "Nome Completo" email@dominio.br [admin|gestor|leitura]');
  process.exit(1);
}
if (!['admin', 'gestor', 'leitura'].includes(papel)) {
  console.error(`Papel inválido: ${papel}. Use admin, gestor ou leitura.`);
  process.exit(1);
}

const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL_ADMIN antes de rodar.');
  process.exit(1);
}

/**
 * Lê as duas senhas. Num terminal de verdade, o que for digitado não aparece na
 * tela. Se a entrada vier de um pipe (automação, teste), lê as duas primeiras
 * linhas sem tentar controlar o terminal.
 */
async function lerSenhas() {
  if (!process.stdin.isTTY) {
    const linhas = [];
    const rl = createInterface({ input: process.stdin });
    for await (const linha of rl) {
      linhas.push(linha);
      if (linhas.length === 2) break;
    }
    rl.close();
    return [linhas[0] ?? '', linhas[1] ?? linhas[0] ?? ''];
  }

  const perguntar = (rotulo) => new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(rotulo, (resposta) => {
      process.stdout.write('\n');
      rl.close();
      resolve(resposta);
    });
    rl._writeToOutput = () => {};   // não ecoa o que for digitado
  });

  return [await perguntar('Senha: '), await perguntar('Repita a senha: ')];
}

const [senha, confirmacao] = await lerSenhas();
if (senha.length < 8) {
  console.error('A senha precisa ter ao menos 8 caracteres.');
  process.exit(1);
}
if (senha !== confirmacao) {
  console.error('As senhas não conferem.');
  process.exit(1);
}

const senhaHash = await hash(senha, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

/**
 * O Railway exige TLS e apresenta certificado próprio; Postgres local
 * normalmente nem tem TLS ligado. A regra: só não usa TLS quando é claramente
 * local — endereço de loopback, soquete unix, ou sslmode=disable explícito.
 */
function configSsl(url) {
  const local = /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(url);
  return local ? undefined : { rejectUnauthorized: false };
}

const cliente = new pg.Client({ connectionString: url, ssl: configSsl(url) });

await cliente.connect();
try {
  const { rows } = await cliente.query(
    `insert into usuario (nome, email, papel, senha_hash)
     values ($1, lower(trim($2)), $3, $4)
     on conflict (email) do update
        set nome = excluded.nome, papel = excluded.papel,
            senha_hash = excluded.senha_hash, ativo = true
     returning id, nome, email, papel`,
    [nome, email, papel, senhaHash],
  );
  const u = rows[0];
  console.log(`\nUsuário pronto: ${u.nome} <${u.email}> — perfil ${u.papel}`);
  console.log('Entre em /login com esse e-mail e a senha que você acabou de definir.');
} finally {
  await cliente.end();
}
