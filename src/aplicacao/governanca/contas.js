/**
 * Contas e permissões no contrato /api/governanca (só o administrador geral):
 *
 *   GET   /contas
 *   POST  /contas
 *   PATCH /contas/:id
 *
 * Os casos de uso são os de usuarios.js; aqui só os nomes do contrato
 * (papéis canônicos admin_geral / diretoria / representante_instituicao).
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';
import { listarUsuarios, criarUsuario, editarUsuario } from '@/aplicacao/usuarios/usuarios.js';
import { PAPEL_CONTRATO, PAPEL_BANCO, isoComFuso } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */

/** @param {any} c formato de usuarios.js */
const conta = (c) => ({
  id: c.id,
  nome: c.nome,
  email: c.email,
  papel: PAPEL_CONTRATO[c.papel] ?? c.papel,
  instituicaoId: c.instituicao?.id ?? null,
  instituicaoNome: c.instituicao?.nome ?? null,
  ativo: c.ativo,
  senhaDefinida: c.senhaDefinida,
  ultimoLogin: isoComFuso(c.ultimoLogin),
  versaoRegistro: c.versaoRegistro,
  ...(c.conviteEnviado !== undefined ? { conviteEnviado: c.conviteEnviado } : {}),
});

/** Corpo do contrato → corpo de usuarios.js. */
function paraBanco(corpo, parcial) {
  const c = corpo ?? {};
  /** @type {Record<string, unknown>} */
  const d = {};
  for (const k of ['nome', 'email', 'ativo']) if (k in c) d[k] = c[k];
  if ('papel' in c) {
    const p = PAPEL_BANCO[String(c.papel)];
    if (!p) {
      throw new ErroDeNegocio('DADOS_INVALIDOS', 'Perfil inválido: admin_geral, diretoria ou representante_instituicao.',
        { campos: [{ campo: 'papel', mensagem: 'Selecione o perfil.' }] });
    }
    d.papel = p;
  }
  if ('instituicaoId' in c) d.instituicaoId = c.instituicaoId || null;
  if (!parcial && d.ativo === undefined) d.ativo = true;
  return d;
}

/** @param {Usuario|null} usuario */
export async function listarContas(usuario) {
  const u = exigir(usuario, 'usuario', 'ver');
  const { dados } = await listarUsuarios(u, {});
  const instituicoes = await comUsuario(u.id, (tx) => tx.consulta(
    `select id, coalesce(nome_fantasia, nome) as nome from instituicao
      where status not in ('desligada') order by 2`));
  return { dados: dados.map(conta), instituicoes };
}

/** @param {Usuario|null} usuario @param {unknown} corpo */
export async function criarConta(usuario, corpo) {
  const u = exigir(usuario, 'usuario', 'criar');
  return { conta: conta(await criarUsuario(u, paraBanco(corpo, false))) };
}

/** @param {Usuario|null} usuario @param {string} id @param {any} corpo */
export async function editarConta(usuario, id, corpo) {
  const u = exigir(usuario, 'usuario', 'editar');
  return { conta: conta(await editarUsuario(u, id, paraBanco(corpo, true), { versaoRegistro: corpo?.versaoRegistro })) };
}
