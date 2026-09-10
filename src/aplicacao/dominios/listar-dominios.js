/**
 * CASO DE USO — Opções dos selects de classificação.
 *
 * Os dois campos obrigatórios do formulário "Nova instituição": "Tipo de
 * instituição" e "Área de atuação". Uma requisição só devolve os dois, porque
 * a tela precisa dos dois ao mesmo tempo e sempre.
 *
 * Só o que está `ativo` aparece. Registro desativado continua no banco para as
 * instituições antigas não ficarem apontando para o nada — ele some do select,
 * não da base.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir } from '@/aplicacao/guarda.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {{ incluirInativos?: boolean }} [opcoes]
 */
export async function listarDominios(usuario, opcoes = {}) {
  const u = exigir(usuario, 'instituicao', 'ver');
  const filtro = opcoes.incluirInativos ? '' : 'where ativo';

  return comUsuario(u.id, async (tx) => {
    const tipos = await tx.consulta(
      `select id, nome, descricao, ativo from tipo_instituicao ${filtro} order by nome`,
    );
    const areas = await tx.consulta(
      `select id, nome, ativo from area_atuacao ${filtro} order by nome`,
    );

    return {
      tiposInstituicao: tipos.map((t) => ({
        id: Number(t.id), nome: t.nome, descricao: t.descricao, ativo: t.ativo,
      })),
      areasAtuacao: areas.map((a) => ({
        id: Number(a.id), nome: a.nome, ativo: a.ativo,
      })),
      // Lista fechada e igual à do banco (enum status_instituicao). Vem daqui
      // para o filtro da tela não ter os rótulos escritos à mão em dois lugares.
      statusInstituicao: [
        { valor: 'em_processo_entrada', rotulo: 'Em processo de entrada' },
        { valor: 'ativa', rotulo: 'Ativa' },
        { valor: 'em_processo_saida', rotulo: 'Em processo de saída' },
        { valor: 'inativa', rotulo: 'Inativa' },
      ],
    };
  });
}
