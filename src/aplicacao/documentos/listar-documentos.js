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
})
  .refine((d) => !!d.instituicaoId !== !!d.reuniaoId, {
    message: 'Informe a instituição ou a reunião.',
    path: ['instituicaoId'],
  });

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 */
export async function listarDocumentos(usuario, filtros) {
  const u = exigir(usuario, 'documento', 'ver');
  const f = validar(esquema, filtros ?? {});

  const coluna = f.instituicaoId ? 'instituicao_id' : 'reuniao_id';
  const valor = f.instituicaoId ?? f.reuniaoId;

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select d.id, d.nome, d.descricao, d.tipo, d.mime_type, d.tamanho_bytes,
              d.storage_path, d.url_externa, d.checksum_sha256, d.created_at,
              autor.nome as enviado_por_nome
         from documento d
         left join vw_usuario_publico autor on autor.id = d.enviado_por
        where d.${coluna} = $1
        order by d.created_at desc`,
      [valor],
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
        enviadoEm: d.created_at,
        enviadoPor: d.enviado_por_nome,
      })),
      total: linhas.length,
    };
  });
}
