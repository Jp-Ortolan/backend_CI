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

    if (inst.status === 'inativa') {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        `"${inst.nome}" está inativa. Reative a instituição antes de vincular representantes.`);
    }

    let linha;
    try {
      linha = await tx.consultaUm(
        `insert into vinculo (pessoa_id, instituicao_id, cargo, data_inicio, observacoes)
              values ($1, $2, $3, $4, $5)
           returning id, pessoa_id, instituicao_id, cargo, status, data_inicio`,
        [d.pessoaId, d.instituicaoId, d.cargo, inicio, d.observacoes],
      );
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
      status: linha.status,
      dataInicio: linha.data_inicio,
    };
  });
}
