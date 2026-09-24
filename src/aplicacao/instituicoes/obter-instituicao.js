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
              criador.nome    as criado_por_nome,
              alterador.nome  as atualizado_por_nome
         from instituicao i
         left join tipo_instituicao   t on t.id = i.tipo_instituicao_id
         left join area_atuacao       a on a.id = i.area_atuacao_id
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

// Em série, não Promise.all: é uma conexão só, dentro de uma transação. Juntas,
// um erro na primeira aborta a transação e esconde a causa real.
    const representantes = await tx.consulta(
        `select v.id as vinculo_id, v.cargo, v.status, v.data_inicio, v.data_fim,
                p.id as pessoa_id, p.nome, p.email, p.telefone
           from vinculo v
           join pessoa p on p.id = v.pessoa_id
          where v.instituicao_id = $1
          order by (v.status = 'ativo') desc, p.nome`,
      [id],
    );

    const documentos = await tx.consulta(
        `select d.id, d.nome, d.descricao, d.tipo, d.mime_type, d.tamanho_bytes,
                d.storage_path, d.url_externa, d.created_at,
                autor.nome as enviado_por_nome
           from documento d
           left join vw_usuario_publico autor on autor.id = d.enviado_por
          where d.instituicao_id = $1
          order by d.created_at desc`,
      [id],
    );

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
      observacoes: i.observacoes,

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
        descricao: i.descricao,
      },

      representantes: representantes.map((r) => ({
        vinculoId: r.vinculo_id,
        pessoaId: r.pessoa_id,
        nome: r.nome,
        email: r.email,
        telefone: r.telefone,
        cargo: r.cargo,
        status: r.status,
        dataInicio: r.data_inicio,
        dataFim: r.data_fim,
      })),
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
        enviadoEm: d.created_at,
        enviadoPor: d.enviado_por_nome,
      })),

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
