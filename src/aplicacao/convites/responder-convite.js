/**
 * CASO DE USO — Registrar a resposta de um convite.
 *
 * Quem anota é o gestor: o representante não tem login, a confirmação chega por
 * e-mail ou telefone. Confirmar não é estar presente — quem confirma e falta
 * continua sendo ausência, e é esse número que interessa medir.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

export const esquemaResposta = z.object({
  status: z.enum(['pendente', 'confirmado', 'recusado'], {
    errorMap: () => ({ message: 'Resposta inválida.' }),
  }),
  observacoes: z.string().trim().max(500).optional().transform((v) => (v || null)),
});

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} conviteId
 * @param {unknown} entrada
 */
export async function responderConvite(usuario, conviteId, entrada) {
  const u = exigir(usuario, 'presenca', 'editar');
  const { status, observacoes } = validar(esquemaResposta, entrada);

  return comUsuario(u.id, async (tx) => {
    const atual = await tx.consultaUm(
      `select c.id, c.status, r.status as status_reuniao, p.nome as pessoa
         from reuniao_convite c
         join reuniao r on r.id = c.reuniao_id
         join pessoa  p on p.id = c.pessoa_id
        where c.id = $1`,
      [conviteId],
    );
    if (!atual) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Convite não encontrado.');

    if (atual.status_reuniao === 'encerrada') {
      throw new ErroDeNegocio('DADOS_INVALIDOS',
        'A reunião já foi encerrada. A confirmação não muda mais nada — '
        + 'o que vale agora é a presença registrada.');
    }

// A constraint convite_respondido_tem_data exige data fora de 'pendente'.
// Fazer aqui deixa a regra visível; o banco continua conferindo.
    const respondidoEm = status === 'pendente' ? null : new Date().toISOString();

    let linha;
    try {
      linha = await tx.consultaUm(
        `update reuniao_convite
            set status = $2::status_confirmacao,
                respondido_em = $3,
                observacoes = coalesce($4, observacoes)
          where id = $1
      returning id, status, respondido_em`,
        [conviteId, status, respondidoEm, observacoes],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Seu perfil não permite registrar confirmações.');
    }

    return {
      id: linha.id,
      pessoa: atual.pessoa,
      status: linha.status,
      respondidoEm: linha.respondido_em,
    };
  });
}
