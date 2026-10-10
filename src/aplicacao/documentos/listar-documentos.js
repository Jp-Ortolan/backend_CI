/**
 * CASO DE USO — Documentos de uma instituição ou de uma reunião (RF50).
 *
 * Nunca traz o conteúdo binário: a consulta é só em `documento`, e os bytes
 * vivem em documento_conteudo. É por isso que as duas tabelas são separadas.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

const esquema = z.object({
  instituicaoId: z.string().uuid().optional(),
  reuniaoId: z.string().uuid().optional(),
  tipo: z.string().trim().max(60).optional(),
})
  .refine((d) => !(d.instituicaoId && d.reuniaoId), {
    message: 'Informe a instituição ou a reunião, não as duas.',
    path: ['instituicaoId'],
  });

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function listarDocumentos(usuario, filtros) {
  const u = exigir(usuario, 'documento', 'ver');
  const f = validar(esquema, filtros ?? {});

  // Sem instituição e sem reunião: os documentos do Fórum (Regimento,
  // planejamento), que não têm dono.
  /** @type {unknown[]} */
  const valores = [];
  let onde;
  if (f.instituicaoId) { valores.push(f.instituicaoId); onde = 'd.instituicao_id = $1'; }
  else if (f.reuniaoId) { valores.push(f.reuniaoId); onde = 'd.reuniao_id = $1'; }
  else onde = 'd.instituicao_id is null and d.reuniao_id is null';
  if (f.tipo) { valores.push(f.tipo); onde += ` and d.tipo = $${valores.length}`; }

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select d.id, d.nome, d.descricao, d.tipo, d.mime_type, d.tamanho_bytes,
              d.storage_path, d.url_externa, d.checksum_sha256, d.created_at,
              d.visibilidade, d.versao, d.substitui_id,
              -- Vigente = nenhuma versão mais nova aponta para ele.
              not exists (select 1 from documento n where n.substitui_id = d.id) as vigente,
              autor.nome as enviado_por_nome
         from documento d
         left join vw_usuario_publico autor on autor.id = d.enviado_por
        where ${onde}
        order by d.created_at desc`,
      valores,
    );

    return {
      dados: linhas.map((d) => ({
        id: d.id,
        nome: d.nome,
        descricao: d.descricao,
        tipo: d.tipo,
        // 'arquivo' guarda os bytes aqui; 'link' mora fora do sistema.
        origem: d.url_externa ? 'link' : 'arquivo',
        urlExterna: d.url_externa,
        mimeType: d.mime_type,
        tamanhoBytes: d.tamanho_bytes === null ? null : Number(d.tamanho_bytes),
        checksum: d.checksum_sha256,
        visibilidade: d.visibilidade,
        versao: Number(d.versao),
        substituiId: d.substitui_id,
        vigente: d.vigente,
        enviadoEm: d.created_at,
        enviadoPor: d.enviado_por_nome,
      })),
      total: linhas.length,
    };
  });
}
