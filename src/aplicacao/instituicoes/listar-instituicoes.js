/**
 * CASO DE USO — Listagem de instituições (RF11, RF12).
 *
 * Sustenta a tela "Instituições": barra de busca, três filtros, tabela paginada
 * e o rodapé "Mostrando 1 a 9 de 122 instituições".
 *
 * Busca e paginação acontecem NO SERVIDOR, não no navegador. São 122
 * instituições hoje e podem ser mil; mandar tudo para o front filtrar seria
 * rápido agora e insustentável depois — e exporia a base inteira a quem
 * abrisse o DevTools.
 */
import { comUsuario } from '@/infraestrutura/banco/consulta.js';
import { exigir, validar } from '@/aplicacao/guarda.js';
import { esquemaFiltro } from './esquemas.js';
import { apenasDigitos } from '@/dominio/cnpj.js';

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
    // O campo é um só e procura por nome OU CNPJ, então precisa decidir qual
    // dos dois a pessoa digitou.
    //
    // A regra é a ausência de letra: um CNPJ só tem dígitos e a pontuação
    // ./-. Qualquer letra significa nome — inclusive em nomes que carregam
    // número, como "Colégio 31 de Março" ou "Unidade 2". Contar dígitos não
    // serviria: esses nomes têm dígitos suficientes para serem confundidos com
    // CNPJ, e a busca voltaria vazia sem explicar por quê.
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
      `select i.id, i.nome, i.cnpj, i.email, i.cidade, i.uf, i.status,
              t.nome as tipo,
              a.nome as area,
              (select count(*) from vinculo v
                where v.instituicao_id = i.id and v.status = 'ativo')
                as representantes_ativos,
              -- count(*) over() traz o total na mesma ida ao banco. Uma segunda
              -- consulta só para contar dobraria o custo de cada página.
              count(*) over() as total_geral
         from instituicao i
         left join tipo_instituicao t on t.id = i.tipo_instituicao_id
         left join area_atuacao     a on a.id = i.area_atuacao_id
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
        cnpj: l.cnpj,
        email: l.email,
        tipo: l.tipo,
        area: l.area,
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
