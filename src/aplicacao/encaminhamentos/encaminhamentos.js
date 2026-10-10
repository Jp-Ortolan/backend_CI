/**
 * CASOS DE USO — Encaminhamentos da reunião (revisão de outubro).
 *
 * O que a reunião decidiu, com responsável e prazo. Quem enxerga a reunião
 * enxerga os encaminhamentos dela; só a gestão escreve.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

const objeto = z.object({
  descricao: z.string().trim().min(3, 'Descreva o encaminhamento.').max(2000),
  responsavel: z.string().trim().max(200).optional().transform((v) => v || null),
  responsavelInstituicaoId: z.string().uuid().optional().nullable(),
  prazo: z.string().regex(DATA, 'Prazo inválido (AAAA-MM-DD).').optional().nullable(),
  status: z.enum(['pendente', 'em_andamento', 'concluido', 'cancelado']).optional(),
  concluidoEm: z.string().regex(DATA).optional().nullable(),
  observacoes: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export const esquemaEncaminhamento = objeto;
export const esquemaEditarEncaminhamento = objeto.partial();

/** @param {Record<string, any>} d */
function paraColunas(d) {
  /** @type {Record<string, [string, unknown]>} */
  const mapa = {
    descricao: ['descricao', d.descricao],
    responsavel: ['responsavel', d.responsavel],
    responsavelInstituicaoId: ['responsavel_instituicao_id', d.responsavelInstituicaoId],
    prazo: ['prazo', d.prazo],
    status: ['status', d.status],
    concluidoEm: ['concluido_em', d.concluidoEm],
    observacoes: ['observacoes', d.observacoes],
  };
  /** @type {Record<string, unknown>} */
  const c = {};
  for (const [k, [col, v]] of Object.entries(mapa)) if (k in d && d[k] !== undefined) c[col] = v ?? null;
  // Concluir sem data: hoje.
  if (c.status === 'concluido' && !c.concluido_em) c.concluido_em = new Date().toISOString().slice(0, 10);
  return c;
}

/** @param {any} e */
const formatar = (e) => ({
  id: e.id,
  reuniaoId: e.reuniao_id,
  descricao: e.descricao,
  responsavel: e.responsavel,
  responsavelInstituicaoId: e.responsavel_instituicao_id,
  prazo: e.prazo,
  status: e.status,
  concluidoEm: e.concluido_em,
  observacoes: e.observacoes,
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 */
export async function listarEncaminhamentos(usuario, reuniaoId) {
  const u = exigir(usuario, 'reuniao', 'ver');
  return comUsuario(u.id, async (tx) => {
    const r = await tx.consultaUm('select id from reuniao where id = $1', [reuniaoId]);
    if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');
    const linhas = await tx.consulta(
      'select * from encaminhamento where reuniao_id = $1 order by prazo nulls last, created_at',
      [reuniaoId]);
    return { dados: linhas.map(formatar) };
  });
}

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} reuniaoId
 * @param {unknown} entrada
 */
export async function criarEncaminhamento(usuario, reuniaoId, entrada) {
  const u = exigir(usuario, 'reuniao', 'editar');
  const d = validar(esquemaEncaminhamento, entrada ?? {});
  const c = paraColunas(d);
  c.reuniao_id = reuniaoId;
  c.created_by = u.id;

  return comUsuario(u.id, async (tx) => {
    const r = await tx.consultaUm('select id from reuniao where id = $1', [reuniaoId]);
    if (!r) throw new ErroDeNegocio('REUNIAO_NAO_ENCONTRADA', 'Reunião não encontrada.');
    const campos = Object.keys(c);
    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into encaminhamento (${campos.join(', ')})
         values (${campos.map((_, n) => `$${n + 1}`).join(', ')}) returning *`,
        Object.values(c));
    } catch (e) { traduzirErroDoBanco(e); }
    if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite registrar encaminhamentos.');
    return formatar(linha);
  });
}

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 */
export async function editarEncaminhamento(usuario, id, entrada) {
  const u = exigir(usuario, 'reuniao', 'editar');
  const d = validar(esquemaEditarEncaminhamento, entrada ?? {});
  const c = paraColunas(d);
  if (!Object.keys(c).length) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');

  return comUsuario(u.id, async (tx) => {
    const campos = Object.keys(c);
    let linha;
    try {
      linha = await tx.consultaUm(
        `update encaminhamento set ${campos.map((k, n) => `${k} = $${n + 2}`).join(', ')}
          where id = $1 returning *`,
        [id, ...Object.values(c)]);
    } catch (e) { traduzirErroDoBanco(e); }
    if (!linha) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Encaminhamento não encontrado.');
    return formatar(linha);
  });
}

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 */
export async function excluirEncaminhamento(usuario, id) {
  const u = exigir(usuario, 'reuniao', 'editar');
  return comUsuario(u.id, async (tx) => {
    const linha = await tx.consultaUm('delete from encaminhamento where id = $1 returning id', [id]);
    if (!linha) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Encaminhamento não encontrado.');
    return { id: linha.id, excluido: true };
  });
}
