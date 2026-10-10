#!/usr/bin/env node
/**
 * Cria um usuário do sistema.
 *
 *   node scripts/criar-usuario.mjs "Ana Admin" ana@centroinovacao.br admin
 *   node scripts/criar-usuario.mjs "Bruno" bruno@alfa.br representante <id-da-instituição>
 *
 * Serve para criar o PRIMEIRO administrador. Depois dele, as contas se criam
 * pela API (POST /api/usuarios), que manda o link de primeiro acesso por e-mail.
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

const [nome, email, papel = 'diretoria', instituicaoId = null] = process.argv.slice(2);

if (!nome || !email) {
  console.error('Uso: node scripts/criar-usuario.mjs "Nome Completo" email@dominio.br '
    + '[admin|diretoria|representante] [id-da-instituição]');
  process.exit(1);
}
if (!['admin', 'diretoria', 'representante'].includes(papel)) {
  console.error(`Papel inválido: ${papel}. Use admin, diretoria ou representante.`);
  process.exit(1);
}
if (papel === 'representante' && !instituicaoId) {
  console.error('Conta de representante precisa do id da instituição (4º argumento).');
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
    `insert into usuario (nome, email, papel, senha_hash, instituicao_id)
     values ($1, lower(trim($2)), $3, $4, $5)
     on conflict (email) do update
        set nome = excluded.nome, papel = excluded.papel,
            senha_hash = excluded.senha_hash, ativo = true,
            instituicao_id = excluded.instituicao_id
     returning id, nome, email, papel`,
    [nome, email, papel, senhaHash, papel === 'representante' ? instituicaoId : null],
  );
  const u = rows[0];
  console.log(`\nUsuário pronto: ${u.nome} <${u.email}> — perfil ${u.papel}`);
  console.log('Entre em /login com esse e-mail e a senha que você acabou de definir.');
} finally {
  await cliente.end();
}
