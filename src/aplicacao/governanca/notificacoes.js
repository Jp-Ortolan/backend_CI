/**
 * Sino e preferências de e-mail (contrato /api/governanca):
 *
 *   GET   /notificacoes
 *   POST  /notificacoes/:id/lida
 *   PATCH /notificacoes/preferencias
 *
 * Notificação é pessoal: o RLS só deixa ler e marcar as próprias.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { validar } from '@/aplicacao/guarda.js';
import { isoComFuso } from './comum.js';

/** @typedef {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao} Usuario */

/** @param {Usuario|null} usuario */
function logado(usuario) {
  if (!usuario || !usuario.ativo) throw new ErroDeNegocio('NAO_AUTENTICADO', 'É preciso estar autenticado.');
  return usuario;
}

/** Só rota interna: "/algo". Nada de "//site", "javascript:" ou URL completa. */
const destinoSeguro = (link) => (typeof link === 'string' && /^\/(?![/\\])[\w\-/.?=&%#]*$/.test(link) ? link : null);

export const PREFERENCIAS_PADRAO = { emailConvocacoes: true, emailSolicitacoes: true, emailEncaminhamentos: true };

/** @param {Usuario|null} usuario */
export async function listarNotificacoes(usuario) {
  const u = logado(usuario);
  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select id, titulo, mensagem, link, lida_em, created_at from notificacao
        where usuario_id = $1 order by created_at desc limit 200`, [u.id]);
    const conta = await tx.consultaUm('select preferencias from usuario where id = $1', [u.id]);
    return {
      dados: linhas.map((n) => ({
        id: n.id,
        titulo: n.titulo,
        mensagem: n.mensagem ?? '',
        criadaEm: isoComFuso(n.created_at),
        lidaEm: isoComFuso(n.lida_em),
        destino: destinoSeguro(n.link),
      })),
      preferencias: { ...PREFERENCIAS_PADRAO, ...(conta?.preferencias ?? {}) },
    };
  });
}

/** @param {Usuario|null} usuario @param {string} id */
export async function marcarLida(usuario, id) {
  const u = logado(usuario);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Notificação não encontrada.');
  const linha = await comUsuario(u.id, (tx) => tx.consultaUm(
    `update notificacao set lida_em = coalesce(lida_em, now())
      where id = $1 and usuario_id = $2 returning id`, [id, u.id]));
  if (!linha) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Notificação não encontrada.');
  return {};
}

const esquemaPreferencias = z.object({
  emailConvocacoes: z.boolean({ invalid_type_error: 'Use verdadeiro ou falso.' }).optional(),
  emailSolicitacoes: z.boolean({ invalid_type_error: 'Use verdadeiro ou falso.' }).optional(),
  emailEncaminhamentos: z.boolean({ invalid_type_error: 'Use verdadeiro ou falso.' }).optional(),
}).strict('Preferência desconhecida.');

/** @param {Usuario|null} usuario @param {unknown} corpo */
export async function salvarPreferencias(usuario, corpo) {
  const u = logado(usuario);
  const p = validar(esquemaPreferencias, corpo ?? {});
  const linha = await comUsuario(u.id, (tx) => tx.consultaUm(
    `update usuario set preferencias = preferencias || $2::jsonb where id = $1 returning preferencias`,
    [u.id, JSON.stringify(p)]));
  if (!linha) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Conta não encontrada.');
  return { preferencias: { ...PREFERENCIAS_PADRAO, ...linha.preferencias } };
}

/**
 * A pessoa quer receber este tipo de e-mail? (consentimento individual)
 *
 * @param {Record<string, unknown>|null|undefined} preferencias
 * @param {keyof typeof PREFERENCIAS_PADRAO} chave
 */
export const querEmail = (preferencias, chave) => ({ ...PREFERENCIAS_PADRAO, ...(preferencias ?? {}) })[chave] !== false;
