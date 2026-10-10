/**
 * CASO DE USO — Ajustar a representação (revisão de outubro).
 *
 * Tipo (titular, suplente, integrante, convidado), cargo na instituição, cargo
 * no Fórum, GTs e o ofício que formalizou. Instituição, pessoa e datas NÃO
 * mudam aqui: trocar isso reescreveria o histórico — para mudar de
 * instituição existe um vínculo novo; para sair, o encerramento.
 *
 * Só a gestão. O representante pede pela solicitação (troca de titular...).
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

export const esquemaEditarVinculo = z.object({
  tipoRepresentacao: z.enum(['titular', 'suplente', 'integrante', 'convidado']),
  cargo: z.string().trim().max(120).transform((v) => v || null),
  cargoForum: z.string().trim().max(120).nullable().transform((v) => v || null),
  oficioDocumentoId: z.string().uuid().nullable(),
  observacoes: z.string().trim().max(2000).transform((v) => v || null),
  grupoTrabalhoIds: z.array(z.coerce.number().int().positive()).max(30),
}).partial();

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} vinculoId
 * @param {unknown} entrada
 */
export async function editarVinculo(usuario, vinculoId, entrada) {
  const u = exigir(usuario, 'vinculo', 'editar');
  if (u.papel === 'representante') {
    throw new ErroDeNegocio('ALTERACAO_EXIGE_APROVACAO',
      'Mudanças na representação são pedidas à Diretoria por solicitação.',
      { acaoSugerida: 'solicitacao' });
  }
  const d = validar(esquemaEditarVinculo, entrada ?? {});

  /** @type {Record<string, unknown>} */
  const colunas = {};
  if ('tipoRepresentacao' in d) colunas.tipo_representacao = d.tipoRepresentacao;
  if ('cargo' in d) colunas.cargo = d.cargo;
  if ('cargoForum' in d) colunas.cargo_forum = d.cargoForum;
  if ('oficioDocumentoId' in d) colunas.oficio_documento_id = d.oficioDocumentoId;
  if ('observacoes' in d) colunas.observacoes = d.observacoes;

  if (!Object.keys(colunas).length && !d.grupoTrabalhoIds) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');
  }

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm('select id, status from vinculo where id = $1', [vinculoId]);
    if (!atual) throw new ErroDeNegocio('VINCULO_INVALIDO', 'Vínculo não encontrado.');
    if (atual.status === 'encerrado') {
      throw new ErroDeNegocio('VINCULO_JA_ENCERRADO',
        'Este vínculo já foi encerrado. O histórico dele não muda.');
    }

    try {
      if (Object.keys(colunas).length) {
        const campos = Object.keys(colunas);
        const linha = await tx.consultaUm(
          `update vinculo set ${campos.map((c, n) => `${c} = $${n + 2}`).join(', ')}
            where id = $1 returning id`,
          [vinculoId, ...Object.values(colunas)],
        );
        if (!linha) throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite esta alteração.');
      }
      if (d.grupoTrabalhoIds) {
        await tx.consulta('delete from vinculo_grupo_trabalho where vinculo_id = $1', [vinculoId]);
        if (d.grupoTrabalhoIds.length) {
          await tx.consulta(
            `insert into vinculo_grupo_trabalho (vinculo_id, grupo_trabalho_id)
             select $1, unnest($2::smallint[]) on conflict do nothing`,
            [vinculoId, d.grupoTrabalhoIds],
          );
        }
      }
    } catch (e) {
      if (e instanceof ErroDeNegocio) throw e;
      traduzirErroDoBanco(e);
    }

    const v = await tx.consultaUm(
      `select v.id, v.tipo_representacao, v.cargo, v.cargo_forum, v.status,
              coalesce((select array_agg(grupo_trabalho_id order by grupo_trabalho_id)
                          from vinculo_grupo_trabalho where vinculo_id = v.id), '{}') as gts
         from vinculo v where v.id = $1`, [vinculoId]);

    return {
      id: v.id,
      tipoRepresentacao: v.tipo_representacao,
      cargo: v.cargo,
      cargoForum: v.cargo_forum,
      status: v.status,
      grupoTrabalhoIds: (v.gts ?? []).map(Number),
    };
  });
}
