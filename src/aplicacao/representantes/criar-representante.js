/**
 * CASO DE USO — Cadastrar representante (RF14, RF15).
 *
 * Cadastrar é duas coisas: registrar a PESSOA e criar o VÍNCULO dela com uma
 * instituição — as duas na mesma transação, senão a falha da segunda deixa
 * pessoa órfã. Se o e-mail já existe, o vínculo novo é criado sobre a pessoa
 * existente (decisão de modelagem 1): é o caso de quem troca de instituição.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export const esquemaRepresentante = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo.').max(200),
  email: z.string().trim().email('E-mail inválido.').optional()
    .or(z.literal('')).transform((v) => (v ? v.toLowerCase() : null)),
  telefone: z.string().trim().max(20).optional()
    .transform((v) => (v || null)),
  observacoes: z.string().trim().max(2000).optional().transform((v) => (v || null)),

  // O vínculo é opcional na API para permitir cadastrar a pessoa antes de saber
  // a instituição, mas a tela deve enviar sempre.
  vinculo: z.object({
    instituicaoId: z.string().uuid('Selecione a instituição.'),
    cargo: z.string().trim().max(120).optional().transform((v) => (v || null)),
    dataInicio: z.string().regex(DATA, 'Informe a data de início (AAAA-MM-DD).').optional(),
  }).optional(),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 */
export async function criarRepresentante(usuario, entrada) {
  const u = exigir(usuario, 'representante', 'criar');
  const dados = validar(esquemaRepresentante, entrada);

  if (dados.vinculo) exigir(usuario, 'vinculo', 'criar');

  return comUsuario(u.id, async (tx) => {
    /** @type {{id: string, nome: string}|null} */
    let pessoa = null;

// Reaproveita a pessoa pelo e-mail. Sem e-mail não dá para afirmar que é a mesma
// pessoa (dois João Silva), então cria outra e a deduplicação fica manual.
    if (dados.email) {
      pessoa = await tx.consultaUm(
        'select id, nome from pessoa where email = $1', [dados.email],
      );
    }

    if (!pessoa) {
      try {
        pessoa = await tx.consultaUm(
          `insert into pessoa (nome, email, telefone, observacoes)
                values ($1, $2, $3, $4)
             returning id, nome`,
          [dados.nome, dados.email, dados.telefone, dados.observacoes],
        );
      } catch (e) {
        traduzirErroDoBanco(e);
      }
      if (!pessoa) {
        throw new ErroDeNegocio('SEM_PERMISSAO',
          'Seu perfil não permite cadastrar representantes.');
      }
    }

    if (!dados.vinculo) {
      return { pessoaId: pessoa.id, nome: pessoa.nome, vinculo: null, pessoaJaExistia: false };
    }

    const inicio = dados.vinculo.dataInicio ?? new Date().toISOString().slice(0, 10);

    let vinculo;
    try {
      vinculo = await tx.consultaUm(
        `insert into vinculo (pessoa_id, instituicao_id, cargo, data_inicio)
              values ($1, $2, $3, $4)
           returning id, instituicao_id, cargo, status, data_inicio`,
        [pessoa.id, dados.vinculo.instituicaoId, dados.vinculo.cargo, inicio],
      );
    } catch (e) {
      // vinculo_ativo_unico: a pessoa já representa essa instituição.
      // 23503 (foreign key): a instituição informada não existe.
      const codigo = /** @type {{code?: string}} */ (e)?.code;
      if (codigo === '23503') {
        throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');
      }
      traduzirErroDoBanco(e);
    }

    if (!vinculo) {
      throw new ErroDeNegocio('SEM_PERMISSAO', 'Seu perfil não permite criar vínculos.');
    }

    return {
      pessoaId: pessoa.id,
      nome: pessoa.nome,
      vinculo: {
        id: vinculo.id,
        instituicaoId: vinculo.instituicao_id,
        cargo: vinculo.cargo,
        status: vinculo.status,
        dataInicio: vinculo.data_inicio,
      },
    };
  });
}
