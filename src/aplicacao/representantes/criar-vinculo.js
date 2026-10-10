/**
 * CASO DE USO — Vincular uma pessoa já cadastrada a uma instituição (RF15, RF17).
 *
 * Complementa criar-representante.js: aqui a pessoa já existe.
 * O vínculo antigo NÃO é encerrado automaticamente — representar duas
 * instituições ao mesmo tempo é legítimo, e adivinhar apagaria período de
 * participação. Quem sai encerra pela rota própria.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaVinculo = z.object({
  pessoaId: z.string().uuid('Selecione o representante.'),
  instituicaoId: z.string().uuid('Selecione a instituição.'),
  cargo: z.string().trim().max(120).optional().transform((v) => (v || null)),
  dataInicio: z.string().regex(DATA, 'Informe a data de início (AAAA-MM-DD).').optional(),
  observacoes: z.string().trim().max(2000).optional().transform((v) => (v || null)),
  tipoRepresentacao: z.enum(['titular', 'suplente', 'integrante', 'convidado'], {
    errorMap: () => ({ message: 'Tipo inválido: titular, suplente, integrante ou convidado.' }),
  }).optional().default('integrante'),
  cargoForum: z.string().trim().max(120).optional().transform((v) => (v || null)),
  oficioDocumentoId: z.string().uuid().optional(),
  grupoTrabalhoIds: z.array(z.coerce.number().int().positive()).max(30).optional(),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 */
export async function criarVinculo(usuario, entrada) {
  const u = exigir(usuario, 'vinculo', 'criar');
  const d = validar(esquemaVinculo, entrada);

  const inicio = d.dataInicio ?? new Date().toISOString().slice(0, 10);

  return comUsuario(u.id, async (tx) => {
    const pessoa = await tx.consultaUm('select id, nome from pessoa where id = $1', [d.pessoaId]);
    if (!pessoa) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Representante não encontrado.');

    const inst = await tx.consultaUm(
      'select id, nome, status from instituicao where id = $1', [d.instituicaoId],
    );
    if (!inst) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    if (['inativa', 'desligada'].includes(inst.status)) {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        `"${inst.nome}" está inativa. Reative a instituição antes de vincular representantes.`);
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into vinculo (pessoa_id, instituicao_id, cargo, data_inicio, observacoes,
                              tipo_representacao, cargo_forum, oficio_documento_id)
              values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id, pessoa_id, instituicao_id, cargo, status, data_inicio,
                     tipo_representacao, cargo_forum`,
        [d.pessoaId, d.instituicaoId, d.cargo, inicio, d.observacoes,
          d.tipoRepresentacao, d.cargoForum, d.oficioDocumentoId ?? null],
      );
      if (linha && d.grupoTrabalhoIds?.length) {
        await tx.consulta(
          `insert into vinculo_grupo_trabalho (vinculo_id, grupo_trabalho_id)
           select $1, unnest($2::smallint[]) on conflict do nothing`,
          [linha.id, d.grupoTrabalhoIds],
        );
      }
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite criar vínculos.');
    }

    return {
      id: linha.id,
      pessoaId: linha.pessoa_id,
      pessoa: pessoa.nome,
      instituicaoId: linha.instituicao_id,
      instituicao: inst.nome,
      cargo: linha.cargo,
      cargoForum: linha.cargo_forum,
      tipoRepresentacao: linha.tipo_representacao,
      status: linha.status,
      dataInicio: linha.data_inicio,
    };
  });
}
