/**
 * CASO DE USO — Listagem de instituições (RF11, RF12).
 *
 * Sustenta a tela Instituições: busca, três filtros, tabela paginada e rodapé.
 * Busca e paginação são no servidor: mandar a base inteira para o front filtrar
 * não escala e exporia tudo a quem abrisse o DevTools.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaFiltro } from './esquemas.js';
import { apenasDigitos } from '@/dominio/cnpj.js';
import { ehGestao } from '@/dominio/permissoes.js';

/** Colunas de ordenação aceitas. Lista fechada: o valor entra na SQL. */
const ORDENACAO = {
  nome: 'i.nome',
  cidade: 'i.cidade',
  status: 'i.status',
  criado: 'i.created_at',
};

/**
 * @typedef {object} InstituicaoDaLista
 * @property {string} id
 * @property {string} nome
 * @property {string|null} cnpj
 * @property {string|null} email
 * @property {string|null} tipo
 * @property {string|null} cidade
 * @property {string|null} uf
 * @property {import('@/dominio/tipos.js').StatusInstituicao} status
 * @property {number} representantesAtivos
 */

/**
 * @param {import('@/infraestrutura/seguranca/sessao.js').UsuarioSessao|null} usuario
 * @param {unknown} filtros
 * @returns {Promise<{ dados: InstituicaoDaLista[], total: number, pagina: number,
 *                     porPagina: number, paginas: number }>}
 */
export async function listarInstituicoes(usuario, filtros) {
  const u = exigir(usuario, 'instituicao', 'ver');
  const f = validar(esquemaFiltro, filtros ?? {});

  /** @type {string[]} */
  const condicoes = [];
  /** @type {unknown[]} */
  const valores = [];

  /** @param {string} sql @param {unknown} valor */
  const onde = (sql, valor) => {
    valores.push(valor);
    condicoes.push(sql.replace('?', `$${valores.length}`));
  };

  if (f.busca) {
// O campo é um só e procura por nome OU CNPJ. A regra é a ausência de letra:
// qualquer letra significa nome, inclusive em Colégio 31 de Março.
    const pareceCnpj = /^[\d.\-/\s]+$/.test(f.busca);
    const digitos = apenasDigitos(f.busca);

    if (pareceCnpj && digitos.length >= 3) {
      // Prefixo, para o filtro já ir respondendo enquanto a pessoa digita.
      onde('i.cnpj like ? || \'%\'', digitos);
    } else {
      // nome_busca já é o nome sem acento e em minúscula (coluna gerada na 001),
      // com índice trigram por cima.
      onde('i.nome_busca like \'%\' || imutavel_unaccent(lower(?)) || \'%\'', f.busca);
    }
  }

  if (f.status) onde('i.status = ?::status_instituicao', f.status);
  if (f.tipoInstituicaoId) onde('i.tipo_instituicao_id = ?', f.tipoInstituicaoId);
  if (f.areaAtuacaoId) onde('i.area_atuacao_id = ?', f.areaAtuacaoId);
  if (f.uf) onde('i.uf = ?', f.uf);
  if (f.vertenteId) onde('i.vertente_id = ?', f.vertenteId);
  if (f.grupoTrabalhoId) {
    onde(`exists (select 1 from instituicao_grupo_trabalho ig
                  where ig.instituicao_id = i.id and ig.grupo_trabalho_id = ?)`, f.grupoTrabalhoId);
  }

  // O representante consulta as instituições integrantes do Fórum (e a dele,
  // em qualquer situação). Cadastro em rascunho ou em análise de OUTRA
  // instituição ainda não é público entre os membros.
  if (!ehGestao(u.papel)) {
    valores.push(u.instituicaoId ?? null);
    condicoes.push(`(i.status in ('ativa', 'em_processo_saida') or i.id = $${valores.length})`);
  }
  if (f.cidade) {
    onde('imutavel_unaccent(lower(i.cidade)) = imutavel_unaccent(lower(?))', f.cidade);
  }

  const filtro = condicoes.length ? `where ${condicoes.join(' and ')}` : '';
  const coluna = ORDENACAO[f.ordenarPor];
  const direcao = f.ordem === 'desc' ? 'desc' : 'asc';

  valores.push(f.porPagina, (f.pagina - 1) * f.porPagina);
  const limite = `limit $${valores.length - 1} offset $${valores.length}`;

  return comUsuario(u.id, async (tx) => {
    const linhas = await tx.consulta(
      `select i.id, i.nome, i.nome_fantasia, i.cnpj, i.email, i.cidade, i.uf, i.status,
              t.nome as tipo,
              a.nome as area,
              ve.nome as vertente,
              coalesce((select array_agg(g.nome order by g.nome)
                          from instituicao_grupo_trabalho ig
                          join grupo_trabalho g on g.id = ig.grupo_trabalho_id
                         where ig.instituicao_id = i.id), '{}') as gts,
              (i.logo_documento_id is not null) as tem_logo,
              (select p.nome from vinculo v join pessoa p on p.id = v.pessoa_id
                where v.instituicao_id = i.id and v.status = 'ativo'
                  and v.tipo_representacao = 'titular' limit 1) as titular,
              (select count(*) from vinculo v
                where v.instituicao_id = i.id and v.status = 'ativo')
                as representantes_ativos,
              -- count(*) over() traz o total na mesma ida ao banco. Uma segunda
              -- consulta só para contar dobraria o custo de cada página.
              count(*) over() as total_geral
         from instituicao i
         left join tipo_instituicao t on t.id = i.tipo_instituicao_id
         left join area_atuacao     a on a.id = i.area_atuacao_id
         left join vertente        ve on ve.id = i.vertente_id
         ${filtro}
        order by ${coluna} ${direcao} nulls last, i.id
        ${limite}`,
      valores,
    );

    const total = linhas.length ? Number(linhas[0].total_geral) : 0;

    return {
      dados: linhas.map((l) => ({
        id: l.id,
        nome: l.nome,
        nomeFantasia: l.nome_fantasia,
        cnpj: l.cnpj,
        email: l.email,
        tipo: l.tipo,
        area: l.area,
        vertente: l.vertente,
        gts: l.gts ?? [],
        // O front distingue "situação da adesão" do status legado; aqui os dois
        // vêm da mesma coluna, com o nome que o contrato do front usa.
        situacaoAdesao: l.status === 'ativa' ? 'aprovada' : l.status,
        titular: l.titular,
        logoUrl: l.tem_logo ? `/api/instituicoes/${l.id}/logo` : null,
        cidade: l.cidade,
        uf: l.uf,
        status: l.status,
        representantesAtivos: Number(l.representantes_ativos),
      })),
      total,
      pagina: f.pagina,
      porPagina: f.porPagina,
      paginas: Math.max(1, Math.ceil(total / f.porPagina)),
    };
  });
}
