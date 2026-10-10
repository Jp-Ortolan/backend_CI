import { cookies, headers } from 'next/headers';
import { consulta, consultaUm } from '@/infraestrutura/banco/consulta.js';
import { DURACAO_SESSAO_HORAS, gerarToken, hashToken } from './tokens.js';

export const COOKIE_SESSAO = 'sessao';

/**
 * @typedef {object} UsuarioSessao
 * @property {string} id
 * @property {string} nome
 * @property {string} email
 * @property {import('@/dominio/permissoes.js').Papel} papel
 * @property {boolean} ativo
 * @property {string|null} instituicaoId  instituição do representante (null para a gestão)
 * @property {string|null} pessoaId       pessoa do cadastro ligada à conta, se houver
 */

// -----------------------------------------------------------------------------
// CORREÇÃO DA SESSÃO (revisão de outubro)
//
// O front publicado (Vercel) e a API (Railway) estão em domínios diferentes.
// Nesse cenário o navegador só devolve o cookie se ele foi gravado com
// SameSite=None e Secure. Antes isso dependia de alguém lembrar de configurar
// COOKIE_CROSS_SITE=1 no Railway; sem a variável, o cookie nascia "lax", o
// navegador não o mandava de volta, toda chamada respondia 401 e o front
// voltava para o login logo depois de entrar.
//
// Agora a API descobre sozinha: se a requisição veio de uma origem HTTPS com
// outro nome de host, o cookie sai SameSite=None + Secure + Partitioned
// (Partitioned é o que o Chrome exige para cookie de terceiro continuar
// funcionando com o bloqueio de cookies de terceiros). COOKIE_CROSS_SITE=1
// continua forçando o modo entre domínios.
//
// Mesmo assim, o jeito MAIS robusto é não ter domínio diferente: um rewrite no
// Vercel de /api/* para o Railway deixa o cookie "de primeira parte" — Safari
// bloqueia cookie de terceiro mesmo com SameSite=None. Ver docs/03-ambientes.md.
// -----------------------------------------------------------------------------

/**
 * A requisição atual vem de outro site?
 *
 * @returns {boolean}
 */
function requisicaoEntreDominios() {
  if (process.env.COOKIE_CROSS_SITE === '1') return true;

  let h;
  try {
    h = headers();
  } catch {
    return false; // fora de requisição (teste de integração): mesmo site
  }

  const origem = h.get('origin');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!origem || !host) return false;

  try {
    const o = new URL(origem);
    const hostApi = host.split(',')[0].trim().split(':')[0];
    // SameSite=None exige Secure, e Secure exige HTTPS na origem. Em http
    // local (localhost:5173 → localhost:3000) o host é o mesmo e lax basta.
    return o.protocol === 'https:' && o.hostname !== hostApi;
  } catch {
    return false;
  }
}

/**
 * Atributos do cookie de sessão.
 *
 * httpOnly    — JavaScript da página não lê o cookie, então um XSS não rouba a sessão
 * sameSite    — 'lax' no mesmo site (protege contra CSRF); 'none' entre domínios
 * secure      — só trafega em HTTPS
 * partitioned — CHIPS: cookie de terceiro que sobrevive ao bloqueio do Chrome
 *
 * @param {Date} expira
 */
function opcoesDoCookie(expira) {
  const entre = requisicaoEntreDominios();
  return {
    httpOnly: true,
    sameSite: /** @type {'none'|'lax'} */ (entre ? 'none' : 'lax'),
    secure: entre || process.env.NODE_ENV === 'production',
    ...(entre ? { partitioned: true } : {}),
    path: '/',
    expires: expira,
  };
}

/** @returns {Date} */
const novaValidade = () => new Date(Date.now() + DURACAO_SESSAO_HORAS * 3600_000);

/**
 * Cria a sessão e grava o cookie.
 *
 * @param {string} usuarioId
 * @param {string|null} [ip]
 * @param {string|null} [agente]
 * @returns {Promise<void>}
 */
export async function abrirSessao(usuarioId, ip, agente) {
  const token = gerarToken();
  const expira = novaValidade();

  await consulta('select auth_criar_sessao($1, $2, $3, $4, $5)', [
    usuarioId, hashToken(token), expira.toISOString(), ip ?? null, agente ?? null,
  ]);

  cookies().set(COOKIE_SESSAO, token, opcoesDoCookie(expira));
}

/**
 * Sai. O cookie é apagado com os MESMOS atributos com que foi criado: entre
 * domínios, um Set-Cookie de remoção sem SameSite=None é ignorado pelo
 * navegador, e o cookie velho continuaria lá.
 *
 * @returns {Promise<void>}
 */
export async function encerrarSessao() {
  const token = cookies().get(COOKIE_SESSAO)?.value;
  if (token) {
    await consulta('select auth_encerrar_sessao($1)', [hashToken(token)]);
  }
  cookies().set(COOKIE_SESSAO, '', { ...opcoesDoCookie(new Date(0)), maxAge: 0 });
}

/**
 * Usuário da requisição atual, já com o papel resolvido. Null se não houver sessão.
 *
 * Renovação deslizante: quem está usando o sistema não é derrubado no meio de
 * uma reunião. Passada metade da validade, a sessão ganha outras 12 horas —
 * no banco e no cookie. Sessão parada continua expirando no prazo.
 *
 * @returns {Promise<UsuarioSessao|null>}
 */
export async function usuarioAtual() {
  const token = cookies().get(COOKIE_SESSAO)?.value;
  if (!token) return null;

  const hash = hashToken(token);
  const u = await consultaUm(
    `select id, nome, email, papel, ativo, instituicao_id, pessoa_id, expira_em
       from auth_ler_sessao($1)`,
    [hash],
  );
  if (!u) return null;

  const restante = new Date(u.expira_em).getTime() - Date.now();
  if (restante < (DURACAO_SESSAO_HORAS * 3600_000) / 2) {
    const expira = novaValidade();
    await consulta('select auth_renovar_sessao($1, $2)', [hash, expira.toISOString()]);
    try {
      cookies().set(COOKIE_SESSAO, token, opcoesDoCookie(expira));
    } catch {
      // Fora de Route Handler o cookie é só leitura. A sessão no banco já foi
      // estendida; o cookie é atualizado na próxima chamada de rota.
    }
  }

  return paraUsuarioSessao(u);
}

/**
 * Linha do banco (snake_case) → usuário da sessão (camelCase). Um lugar só,
 * para o login e a leitura da sessão devolverem exatamente o mesmo formato.
 *
 * @param {any} l
 * @returns {UsuarioSessao}
 */
export function paraUsuarioSessao(l) {
  return {
    id: l.id,
    nome: l.nome,
    email: l.email,
    papel: l.papel,
    ativo: l.ativo,
    instituicaoId: l.instituicao_id ?? null,
    pessoaId: l.pessoa_id ?? null,
  };
}
