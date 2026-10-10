/**
 * CASO DE USO — Detalhe da instituição (RF08).
 *
 * Monta a tela inteira numa ida só ao banco: os seis cards da Visão geral e a
 * aba Representantes. Uma requisição por card faria a tela piscar em seis tempos.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { ErroDeNegocio } from '@/dominio/erros.js';
import { exigir } from '@/aplicacao/guarda.js';
import { formatarCnpj } from '@/dominio/cnpj.js';
import { ehGestao } from '@/dominio/permissoes.js';
import { pendenciasDoCadastro } from './pendencias.js';

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function obterInstituicao(usuario, id) {
  const u = exigir(usuario, 'instituicao', 'ver');

  return comUsuario(u.id, async (tx) => {
    const i = await tx.consultaUm(
      `select i.*,
              t.nome as tipo_nome,
              a.nome as area_nome,
              ve.nome as vertente_nome,
              subst.nome as substituida_por_nome,
              criador.nome    as criado_por_nome,
              alterador.nome  as atualizado_por_nome
         from instituicao i
         left join tipo_instituicao   t on t.id = i.tipo_instituicao_id
         left join area_atuacao       a on a.id = i.area_atuacao_id
         left join vertente          ve on ve.id = i.vertente_id
         left join instituicao    subst on subst.id = i.substituida_por_id
         -- vw_usuario_publico e não a tabela usuario: a política
         -- usuario_ler_proprio esconde a linha de outro usuário, e a tela
         -- precisa do nome de quem cadastrou. A view expõe só id, nome e papel.
         left join vw_usuario_publico criador   on criador.id   = i.created_by
         left join vw_usuario_publico alterador on alterador.id = i.updated_by
        where i.id = $1`,
      [id],
    );

// Sem linha pode ser não existe ou o RLS não deixou ver. Responder 404 nos dois
// casos evita confirmar registro que a pessoa não podia consultar.
    if (!i) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Instituição não encontrada.');

    // Observações internas, pendências e solicitações são da gestão e da
    // própria instituição. Para o representante de OUTRA instituição, esta
    // tela é a ficha pública dela.
    const propria = ehGestao(u.papel) || i.id === u.instituicaoId;

// Em série, não Promise.all: é uma conexão só, dentro de uma transação. Juntas,
// um erro na primeira aborta a transação e esconde a causa real.
    const representantes = await tx.consulta(
        `select v.id as vinculo_id, v.cargo, v.status, v.data_inicio, v.data_fim,
                v.tipo_representacao, v.cargo_forum, v.motivo_encerramento,
                v.oficio_documento_id,
                p.id as pessoa_id, p.nome, p.email, p.telefone
           from vinculo v
           join pessoa p on p.id = v.pessoa_id
          where v.instituicao_id = $1
          order by (v.status = 'ativo') desc,
                   array_position(array['titular','suplente','integrante','convidado']::tipo_representacao[],
                                  v.tipo_representacao),
                   p.nome`,
      [id],
    );

    const documentos = await tx.consulta(
        `select d.id, d.nome, d.descricao, d.tipo, d.mime_type, d.tamanho_bytes,
                d.storage_path, d.url_externa, d.created_at, d.visibilidade, d.versao,
                d.substitui_id,
                autor.nome as enviado_por_nome
           from documento d
           left join vw_usuario_publico autor on autor.id = d.enviado_por
          where d.instituicao_id = $1
          order by d.created_at desc`,
      [id],
    );

    const grupos = await tx.consulta(
      `select g.id, g.nome from instituicao_grupo_trabalho ig
         join grupo_trabalho g on g.id = ig.grupo_trabalho_id
        where ig.instituicao_id = $1 order by g.nome`,
      [id],
    );

    // Linha do tempo da situação (rascunho → em análise → ativa...). O RLS só
    // devolve para a gestão e para a própria instituição.
    const historicoStatus = await tx.consulta(
      `select h.status_anterior, h.status_novo, h.motivo, h.alterado_em,
              autor.nome as alterado_por
         from instituicao_status_historico h
         left join vw_usuario_publico autor on autor.id = h.alterado_por
        where h.instituicao_id = $1
        order by h.alterado_em desc, h.id desc
        limit 50`,
      [id],
    );

    const solicitacoes = propria
      ? await tx.consultaUm(
        `select count(*) filter (where status = 'pendente')::int as pendentes,
                count(*)::int as total
           from solicitacao where instituicao_id = $1`, [id])
      : null;

    const pendencias = propria ? await pendenciasDoCadastro(tx, id) : null;

// Indicador vem sempre das views (decisão 3): a view dá o percentual e a
// consulta ao lado dá as contagens brutas dos cards.
    const resumo = await tx.consultaUm(
      `select w.reunioes_esperadas,
                w.reunioes_com_presenca,
                w.percentual_participacao,
                (select count(*) from presenca pr
                  where pr.instituicao_id = $1 and pr.status = 'presente')
                  as participacoes_totais,
                (select max(pr.horario_checkin) from presenca pr
                  where pr.instituicao_id = $1 and pr.status = 'presente')
                  as ultima_participacao,
                (select r.titulo from presenca pr
                   join reuniao r on r.id = pr.reuniao_id
                  where pr.instituicao_id = $1 and pr.status = 'presente'
                  order by pr.horario_checkin desc limit 1)
                  as ultima_reuniao
           from vw_participacao_instituicao w
        where w.instituicao_id = $1`,
      [id],
    );

    return {
      id: i.id,
      nome: i.nome,
      razaoSocial: i.razao_social,
      nomeFantasia: i.nome_fantasia,
      cnpj: i.cnpj,
      cnpjFormatado: formatarCnpj(i.cnpj),
      status: i.status,
      email: i.email,
      telefone: i.telefone,
      site: i.site,
      dataFundacao: i.data_fundacao,
      dataEntrada: i.data_entrada,
      dataSaida: i.data_saida,
      responsavel: i.responsavel,
      // Observação interna: nunca sai para outra instituição.
      observacoes: propria ? i.observacoes : null,
      dataIngressoForum: i.data_entrada,
      motivoSaida: i.motivo_saida,
      substituidaPor: i.substituida_por_id
        ? { id: i.substituida_por_id, nome: i.substituida_por_nome } : null,

      redesSociais: i.redes_sociais ?? {},
      contatosComunicacao: propria ? (i.contatos_comunicacao ?? []) : [],
      autorizaDivulgacao: i.autoriza_divulgacao,
      autorizaLogo: i.autoriza_logo,
      logo: i.logo_documento_id
        ? { documentoId: i.logo_documento_id, url: `/api/instituicoes/${i.id}/logo` }
        : null,

      endereco: {
        logradouro: i.logradouro,
        numero: i.numero,
        bairro: i.bairro,
        cidade: i.cidade,
        estado: i.uf,
        cep: i.cep,
        complemento: i.complemento,
      },

      classificacao: {
        tipoInstituicaoId: i.tipo_instituicao_id,
        tipo: i.tipo_nome,
        areaAtuacaoId: i.area_atuacao_id,
        area: i.area_nome,
        vertenteId: i.vertente_id,
        vertente: i.vertente_nome,
        gruposTrabalho: grupos.map((g) => ({ id: Number(g.id), nome: g.nome })),
        descricao: i.descricao,
      },

      representantes: representantes.map((r) => ({
        vinculoId: r.vinculo_id,
        pessoaId: r.pessoa_id,
        nome: r.nome,
        email: r.email,
        telefone: r.telefone,
        cargo: r.cargo,
        cargoForum: r.cargo_forum,
        tipoRepresentacao: r.tipo_representacao,
        status: r.status,
        dataInicio: r.data_inicio,
        dataFim: r.data_fim,
        motivoEncerramento: r.motivo_encerramento,
        oficioDocumentoId: r.oficio_documento_id,
      })),
      titular: representantes.find((r) => r.status === 'ativo'
        && r.tipo_representacao === 'titular')?.nome ?? null,
      suplente: representantes.find((r) => r.status === 'ativo'
        && r.tipo_representacao === 'suplente')?.nome ?? null,
      totalRepresentantes: representantes.length,
      representantesAtivos: representantes.filter((r) => r.status === 'ativo').length,

      documentos: documentos.map((d) => ({
        id: d.id,
        nome: d.nome,
        descricao: d.descricao,
        tipo: d.tipo,
        // storage_path é chave interna do armazenamento e não sai para a tela.
        origem: d.url_externa ? 'link' : 'arquivo',
        urlExterna: d.url_externa,
        mimeType: d.mime_type,
        tamanhoBytes: d.tamanho_bytes === null ? null : Number(d.tamanho_bytes),
        visibilidade: d.visibilidade,
        versao: Number(d.versao),
        substituiId: d.substitui_id,
        enviadoEm: d.created_at,
        enviadoPor: d.enviado_por_nome,
      })),

      historicoStatus: historicoStatus.map((h) => ({
        de: h.status_anterior,
        para: h.status_novo,
        motivo: h.motivo,
        em: h.alterado_em,
        por: h.alterado_por,
      })),

      solicitacoes: solicitacoes
        ? { pendentes: solicitacoes.pendentes, total: solicitacoes.total } : null,

      // O que falta para o cadastro poder ir para análise. null para quem não
      // é da instituição nem da gestão.
      pendencias,

      participacao: {
        participacoesTotais: Number(resumo?.participacoes_totais ?? 0),
        reunioesEsperadas: Number(resumo?.reunioes_esperadas ?? 0),
        reunioesParticipadas: Number(resumo?.reunioes_com_presenca ?? 0),
        // null e não 0: instituição que nunca teve reunião esperada não tem
        // média nenhuma, e mostrar "0%" faria parecer que ela nunca comparece.
        mediaPresenca: resumo?.percentual_participacao ?? null,
        ultimaParticipacao: resumo?.ultima_participacao ?? null,
        ultimaReuniao: resumo?.ultima_reuniao ?? null,
      },

      cadastro: {
        criadoEm: i.created_at,
        criadoPor: i.criado_por_nome,
        atualizadoEm: i.updated_at,
        atualizadoPor: i.atualizado_por_nome,
      },
    };
  });
}
