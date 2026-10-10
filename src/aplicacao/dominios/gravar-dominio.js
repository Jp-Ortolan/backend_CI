/**
 * CASO DE USO — Manter as listas do Fórum (revisão de outubro).
 *
 * Vertentes e GTs nascem vazios (migration 009): os nomes são decisão do
 * Fórum. A gestão cadastra, renomeia e desativa por aqui. Desativar tira do
 * select sem apagar — instituição antiga continua apontando para a vertente.
 */
import { z } from 'zod';
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { traduzirErroDoBanco } from '@/infraestrutura/banco/traduzir-erros.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir, validar } from '@/aplicacao/guarda.js';

/** Lista → tabela e colunas aceitas. Lista fechada: o nome entra na SQL. */
const LISTAS = {
  vertentes: { tabela: 'vertente', colunas: ['nome', 'descricao', 'ativo'] },
  gruposTrabalho: { tabela: 'grupo_trabalho', colunas: ['nome', 'descricao', 'vertente_id', 'ativo'] },
  tiposInstituicao: { tabela: 'tipo_instituicao', colunas: ['nome', 'descricao', 'ativo'] },
  areasAtuacao: { tabela: 'area_atuacao', colunas: ['nome', 'ativo'] },
  tiposAtividade: { tabela: 'tipo_atividade', colunas: ['nome', 'natureza', 'conta_participacao_padrao', 'ativo'] },
};

export const esquemaDominio = z.object({
  lista: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(LISTAS)), {
    errorMap: () => ({ message: `Lista inválida: ${Object.keys(LISTAS).join(', ')}.` }),
  }),
  id: z.coerce.number().int().positive().optional(),
  nome: z.string().trim().min(2, 'Informe o nome.').max(120).optional(),
  descricao: z.string().trim().max(500).optional().nullable(),
  vertenteId: z.coerce.number().int().positive().optional().nullable(),
  natureza: z.enum(['reuniao', 'evento']).optional(),
  contaParticipacaoPadrao: z.boolean().optional(),
  ativo: z.boolean().optional(),
});

/**
 * Cria (sem id) ou altera (com id).
 *
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} entrada
 */
export async function gravarDominio(usuario, entrada) {
  const u = exigir(usuario, 'instituicao', 'aprovar'); // admin e Diretoria
  const d = validar(esquemaDominio, entrada ?? {});
  const { tabela, colunas } = LISTAS[/** @type {keyof typeof LISTAS} */ (d.lista)];

  /** @type {Record<string, unknown>} */
  const valores = {
    nome: d.nome, descricao: d.descricao, vertente_id: d.vertenteId,
    natureza: d.natureza, conta_participacao_padrao: d.contaParticipacaoPadrao, ativo: d.ativo,
  };
  const c = Object.fromEntries(
    Object.entries(valores).filter(([k, v]) => colunas.includes(k) && v !== undefined));

  if (!d.id && !c.nome) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe o nome.');
  if (!d.id && tabela === 'tipo_atividade' && !c.natureza) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Informe se o tipo é de reunião ou de evento.');
  }
  if (!Object.keys(c).length) throw new ErroDeNegocio('DADOS_INVALIDOS', 'Nada para gravar.');

  return comUsuario(u.id, async (tx) => {
    const campos = Object.keys(c);
    let linha;
    try {
      linha = d.id
        ? await tx.consultaUm(
          `update ${tabela} set ${campos.map((k, n) => `${k} = $${n + 2}`).join(', ')}
            where id = $1 returning *`, [d.id, ...Object.values(c)])
        : await tx.consultaUm(
          `insert into ${tabela} (${campos.join(', ')})
           values (${campos.map((_, n) => `$${n + 1}`).join(', ')}) returning *`,
          Object.values(c));
    } catch (e) { traduzirErroDoBanco(e); }
    if (!linha) {
      throw new ErroDeNegocio(d.id ? 'NAO_ENCONTRADO' : 'SEM_PERMISSAO',
        d.id ? 'Item não encontrado.' : 'Seu perfil não permite alterar estas listas.');
    }
    return { lista: d.lista, ...linha, id: Number(linha.id) };
  });
}
