/**
 * CASO DE USO — Opções dos selects.
 *
 * Tudo o que os formulários precisam numa requisição só. Só o que está
 * `ativo` aparece: registro desativado some do select, não da base.
 *
 * Revisão de outubro: vertentes, GTs, tipos de reunião/evento e as listas
 * fechadas novas (situação da instituição, tipo de representação, tipos de
 * solicitação e de documento, modalidade).
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir } from '@/aplicacao/guarda.js';
import { STATUS_INSTITUICAO, ROTULO_STATUS_INSTITUICAO } from '@/aplicacao/instituicoes/esquemas.js';
import { TIPOS_SOLICITACAO, ROTULO_SOLICITACAO } from '@/aplicacao/solicitacoes/esquemas.js';
import { TIPOS_DOCUMENTO } from '@/aplicacao/documentos/enviar-documento.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {{ incluirInativos?: boolean }} [opcoes]
 */
export async function listarDominios(usuario, opcoes = {}) {
  const u = exigir(usuario, 'instituicao', 'ver');
  const filtro = opcoes.incluirInativos ? '' : 'where ativo';

  return comUsuario(u.id, async (tx) => {
    const tipos = await tx.consulta(
      `select id, nome, descricao, ativo from tipo_instituicao ${filtro} order by nome`);
    const areas = await tx.consulta(
      `select id, nome, ativo from area_atuacao ${filtro} order by nome`);
    const vertentes = await tx.consulta(
      `select id, nome, descricao, ativo from vertente ${filtro} order by nome`);
    const gts = await tx.consulta(
      `select id, nome, descricao, vertente_id, ativo from grupo_trabalho ${filtro} order by nome`);
    const tiposAtividade = await tx.consulta(
      `select id, nome, natureza, conta_participacao_padrao, ativo
         from tipo_atividade ${filtro} order by natureza, id`);

    return {
      tiposInstituicao: tipos.map((t) => ({
        id: Number(t.id), nome: t.nome, descricao: t.descricao, ativo: t.ativo,
      })),
      areasAtuacao: areas.map((a) => ({ id: Number(a.id), nome: a.nome, ativo: a.ativo })),
      vertentes: vertentes.map((v) => ({
        id: Number(v.id), nome: v.nome, descricao: v.descricao, ativo: v.ativo,
      })),
      gruposTrabalho: gts.map((g) => ({
        id: Number(g.id), nome: g.nome, descricao: g.descricao,
        vertenteId: g.vertente_id === null ? null : Number(g.vertente_id), ativo: g.ativo,
      })),
      tiposAtividade: tiposAtividade.map((t) => ({
        id: Number(t.id), nome: t.nome, natureza: t.natureza,
        contaParticipacaoPadrao: t.conta_participacao_padrao, ativo: t.ativo,
      })),

      // Listas fechadas, iguais aos enums do banco. Vêm daqui para a tela não
      // ter os rótulos escritos à mão em dois lugares.
      statusInstituicao: STATUS_INSTITUICAO.map((valor) => ({
        valor, rotulo: ROTULO_STATUS_INSTITUICAO[valor],
      })),
      tiposRepresentacao: [
        { valor: 'titular', rotulo: 'Titular' },
        { valor: 'suplente', rotulo: 'Suplente' },
        { valor: 'integrante', rotulo: 'Integrante adicional' },
        { valor: 'convidado', rotulo: 'Convidado' },
      ],
      statusReuniao: [
        { valor: 'rascunho', rotulo: 'Rascunho' },
        { valor: 'agendada', rotulo: 'Publicada' },
        { valor: 'em_andamento', rotulo: 'Em andamento' },
        { valor: 'encerrada', rotulo: 'Encerrada' },
        { valor: 'cancelada', rotulo: 'Cancelada' },
      ],
      modalidades: [
        { valor: 'presencial', rotulo: 'Presencial' },
        { valor: 'online', rotulo: 'On-line' },
        { valor: 'hibrida', rotulo: 'Híbrida' },
      ],
      tiposSolicitacao: TIPOS_SOLICITACAO.map((valor) => ({ valor, rotulo: ROTULO_SOLICITACAO[valor] })),
      tiposDocumento: TIPOS_DOCUMENTO,
    };
  });
}
