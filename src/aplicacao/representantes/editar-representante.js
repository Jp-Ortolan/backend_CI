/**
 * CASO DE USO — Editar os dados da pessoa.
 *
 * Só nome, e-mail, telefone e observações. Cargo e instituição NÃO se editam
 * aqui: eles pertencem ao vínculo, e trocar o cargo de um vínculo antigo
 * reescreveria o histórico. Para mudar de instituição existe criar-vinculo; para
 * sair, encerrar-vinculo.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

/**
 * ATENÇÃO à ordem de .optional() e .transform().
 *
 * `campo.optional().transform(v => v || null)` embrulha o opcional num efeito:
 * o transform roda MESMO quando a chave não foi enviada, devolve null, e a
 * chave aparece no resultado. Num PATCH de um campo só, os outros três
 * chegariam aqui como null e apagariam o que estava gravado — sem erro nenhum
 * para avisar.
 *
 * Com `.partial()` sobre o objeto base é o contrário: chave ausente é
 * descartada antes de qualquer transform, e só o que foi enviado chega ao
 * update. Enviar `email: ""` continua limpando o campo, que é intencional.
 */
const objetoRepresentante = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo.').max(200),
  email: z.string().trim().email('E-mail inválido.')
    .or(z.literal('')).transform((v) => (v ? v.toLowerCase() : null)),
  telefone: z.string().trim().max(20).transform((v) => (v || null)),
  observacoes: z.string().trim().max(2000).transform((v) => (v || null)),
});

export const esquemaEditarRepresentante = objetoRepresentante.partial();

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @param {unknown} entrada
 */
export async function editarRepresentante(usuario, id, entrada) {
  const u = exigir(usuario, 'representante', 'editar');
  const dados = validar(esquemaEditarRepresentante, entrada ?? {});

  /** @type {Record<string, any>} */
  const colunas = {};
  if ('nome' in dados) colunas.nome = dados.nome;
  if ('email' in dados) colunas.email = dados.email;
  if ('telefone' in dados) colunas.telefone = dados.telefone;
  if ('observacoes' in dados) colunas.observacoes = dados.observacoes;

  if (Object.keys(colunas).length === 0) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nenhum campo foi enviado para alteração.');
  }

  const campos = Object.keys(colunas);
  const atribuicoes = campos.map((c, n) => `${c} = $${n + 2}`);

  return comUsuario(u.id, async (tx) => {
    const existe = await tx.consultaUm('select id from pessoa where id = $1', [id]);
    if (!existe) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Representante não encontrado.');

    let linha;
    try {
      linha = await tx.consultaUm(
        `update pessoa set ${atribuicoes.join(', ')}
          where id = $1
      returning id, nome, email, telefone`,
        [id, ...Object.values(colunas)],
      );
    } catch (e) {
      traduzirErroDoBanco(e);
    }

    if (!linha) {
      throw new ErroDeNegocio('SEM_PERMISSAO',
        'Seu perfil não permite editar representantes.');
    }

    return {
      id: linha.id, nome: linha.nome, email: linha.email, telefone: linha.telefone,
    };
  });
}
