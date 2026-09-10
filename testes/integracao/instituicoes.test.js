/**
 * Testes de integração da Sprint 1 — rodam contra um PostgreSQL de verdade.
 *
 *   DATABASE_URL=postgresql://app_web:...@localhost:5432/ecossistema \
 *   DATABASE_URL_ADMIN=postgresql://postgres:...@localhost:5432/ecossistema \
 *   npm run test:integracao
 *
 * Sem as duas variáveis, o arquivo é pulado inteiro — assim quem ainda não
 * subiu o banco continua conseguindo rodar `npm test`.
 *
 * POR QUE DUAS CONEXÕES
 * DATABASE_URL é a da aplicação e usa `app_web`, que NÃO é dono das tabelas —
 * é isso que faz o RLS valer. Se os testes rodassem como dono, as políticas
 * seriam ignoradas e os casos de permissão passariam sem provar nada.
 * DATABASE_URL_ADMIN é só para montar e desmontar o cenário.
 *
 * Para o app_web conseguir conectar no banco local, uma vez:
 *   psql -c "alter role app_web login password 'app_web'"
 *
 * O que estes testes provam, e os testes SQL sozinhos não provam: que a camada
 * de aplicação valida antes de o banco recusar, que traduz o erro do banco no
 * código do contrato, e que o perfil errado não passa.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { fecharPool } from '@/infraestrutura/banco/pool.js';

import { criarInstituicao } from '@/aplicacao/instituicoes/criar-instituicao.js';
import { listarInstituicoes } from '@/aplicacao/instituicoes/listar-instituicoes.js';
import { obterInstituicao } from '@/aplicacao/instituicoes/obter-instituicao.js';
import { editarInstituicao } from '@/aplicacao/instituicoes/editar-instituicao.js';
import { alterarStatusInstituicao } from '@/aplicacao/instituicoes/alterar-status-instituicao.js';
import { excluirInstituicao } from '@/aplicacao/instituicoes/excluir-instituicao.js';
import { criarRepresentante } from '@/aplicacao/representantes/criar-representante.js';
import { criarVinculo } from '@/aplicacao/representantes/criar-vinculo.js';
import { listarDominios } from '@/aplicacao/dominios/listar-dominios.js';
import { obterDashboard } from '@/aplicacao/indicadores/obter-dashboard.js';

const { Client } = pg;

const URL_APP = process.env.DATABASE_URL ?? '';
const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const rodar = URL_APP.length > 0 && URL_ADMIN.length > 0;

/** @type {import('pg').Client} */
let db;

/** Marca única desta execução, para a limpeza não tocar em dado de ninguém. */
const MARCA = `t${Date.now()}`;

/** @type {any} */ let admin;
/** @type {any} */ let gestor;
/** @type {any} */ let leitura;
/** @type {number} */ let tipoId;
/** @type {number} */ let areaId;
/** @type {string[]} */ const instituicoesCriadas = [];
/** @type {string[]} */ const pessoasCriadas = [];

/** CNPJs válidos (dígito verificador conferido) reservados para os testes. */
const CNPJ_A = '11222333000181';
const CNPJ_B = '11444777000161';

/**
 * Molde de instituição válida. Cada teste sobrescreve só o que lhe interessa.
 * @param {Record<string, unknown>} [ajustes]
 */
const instituicaoValida = (ajustes = {}) => ({
  nome: `Instituição ${MARCA}`,
  cnpj: CNPJ_A,
  dataFundacao: '1998-03-15',
  status: 'ativa',
  email: `contato.${MARCA}@exemplo.br`,
  telefone: '(42) 3633-3333',
  site: 'www.exemplo.br',
  logradouro: 'Rua das Chaves',
  numero: '123',
  bairro: 'Centro',
  cidade: 'Guarapuava',
  estado: 'PR',
  cep: '85000-000',
  complemento: 'Bloco A',
  tipoInstituicaoId: tipoId,
  areaAtuacaoId: areaId,
  descricao: 'Instituição criada pelos testes de integração.',
  ...ajustes,
});

before(async () => {
  if (!rodar) return;

  db = new Client({
    connectionString: URL_ADMIN,
    ssl: /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(URL_ADMIN)
      ? undefined : { rejectUnauthorized: false },
  });
  await db.connect();

  /** @param {'admin'|'gestor'|'leitura'} papel */
  const criarUsuario = async (papel) => {
    const { rows } = await db.query(
      `insert into usuario (nome, email, papel)
       values ($1, $2, $3) returning id, nome, email, papel, ativo`,
      [`Teste ${papel} ${MARCA}`, `${papel}.${MARCA}@exemplo.br`, papel],
    );
    return rows[0];
  };

  admin = await criarUsuario('admin');
  gestor = await criarUsuario('gestor');
  leitura = await criarUsuario('leitura');

  const { rows: t } = await db.query('select id from tipo_instituicao order by id limit 1');
  const { rows: a } = await db.query('select id from area_atuacao order by id limit 1');
  tipoId = t[0].id;
  areaId = a[0].id;
});

after(async () => {
  if (!rodar) return;
  // Ordem importa: vínculo referencia instituição com on delete restrict, e a
  // trigger de proteção recusa apagar instituição que ainda tem vínculo.
  for (const id of pessoasCriadas) {
    await db.query('delete from vinculo where pessoa_id = $1', [id]);
    await db.query('delete from pessoa where id = $1', [id]);
  }
  for (const id of instituicoesCriadas) {
    await db.query('delete from vinculo where instituicao_id = $1', [id]);
    await db.query('delete from instituicao where id = $1', [id]);
  }
  await db.query('delete from usuario where email like $1', [`%.${MARCA}@exemplo.br`]);
  await db.end();
  // Sem isto o processo fica 30 segundos de pé esperando o pool ocioso.
  await fecharPool();
});

/** @param {string} id */
const anotarInstituicao = (id) => { instituicoesCriadas.push(id); return id; };

// ---------------------------------------------------------------- cadastro
describe('cadastro de instituição', { skip: !rodar }, () => {
  test('cadastra e encontra pela busca', async () => {
    const criada = await criarInstituicao(gestor, instituicaoValida());
    anotarInstituicao(criada.id);

    assert.ok(criada.id, 'deveria devolver o id da instituição criada');
    assert.equal(criada.status, 'ativa');

    const lista = await listarInstituicoes(gestor, { busca: MARCA });
    assert.equal(lista.total, 1, 'a busca pelo nome deveria achar exatamente uma');
    assert.equal(lista.dados[0].id, criada.id);
    assert.equal(lista.dados[0].cidade, 'Guarapuava');
  });

  test('a busca por CNPJ funciona com e sem pontuação', async () => {
    for (const termo of [CNPJ_A, '11.222.333/0001-81', '11222333']) {
      const r = await listarInstituicoes(gestor, { busca: termo });
      assert.equal(r.total, 1, `"${termo}" deveria achar a instituição pelo CNPJ`);
    }
  });

  test('nome com número não é confundido com CNPJ', async () => {
    // "Colégio 31 de Março" tem dígitos suficientes para uma regra ingênua
    // mandar a busca para a coluna cnpj — e aí o campo devolveria vazio sem
    // explicar por quê. A regra é a presença de letra, não a de número.
    const c = await criarInstituicao(gestor, instituicaoValida({
      nome: `Colegio 31 de Marco ${MARCA}`,
      cnpj: gerarCnpj(),
      email: `col31.${MARCA}@exemplo.br`,
    }));
    anotarInstituicao(c.id);

    const r = await listarInstituicoes(gestor, { busca: 'Colegio 31' });
    assert.equal(r.total, 1, 'deveria encontrar pelo nome, mesmo com número nele');
    assert.equal(r.dados[0].id, c.id);
  });

  test('a busca ignora acento', async () => {
    const r = await listarInstituicoes(gestor, { busca: 'Colégio' });
    assert.ok(r.total >= 1, '"Colégio" deveria encontrar "Colegio"');
  });

  test('recusa CNPJ com dígito verificador errado antes de chegar ao banco', async () => {
    await assert.rejects(
      () => criarInstituicao(gestor, instituicaoValida({ cnpj: '11222333000182' })),
      (/** @type {any} */ e) => {
        assert.equal(e.codigo, 'DADOS_INVALIDOS');
        assert.ok(e.extra?.campos?.some((/** @type {any} */ c) => c.campo === 'cnpj'),
          'o erro deveria apontar o campo cnpj');
        return true;
      },
    );
  });

  test('recusa CNPJ repetido com o código que o front trata', async () => {
    await assert.rejects(
      () => criarInstituicao(gestor, instituicaoValida({ nome: `Outra ${MARCA}` })),
      (/** @type {any} */ e) => e.codigo === 'CNPJ_DUPLICADO' && e.status === 409,
    );
  });

  test('recusa descrição acima de 500 caracteres', async () => {
    await assert.rejects(
      () => criarInstituicao(gestor, instituicaoValida({
        cnpj: CNPJ_B, descricao: 'x'.repeat(501),
      })),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('recusa cadastrar como inativa sem data de saída', async () => {
    await assert.rejects(
      () => criarInstituicao(gestor, instituicaoValida({ cnpj: CNPJ_B, status: 'inativa' })),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('perfil de consulta não cadastra', async () => {
    await assert.rejects(
      () => criarInstituicao(leitura, instituicaoValida({ cnpj: CNPJ_B })),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO' && e.status === 403,
    );
  });

  test('sem usuário não passa', async () => {
    await assert.rejects(
      () => criarInstituicao(null, instituicaoValida({ cnpj: CNPJ_B })),
      (/** @type {any} */ e) => e.codigo === 'NAO_AUTENTICADO',
    );
  });
});

// ------------------------------------------------------------------ detalhe
describe('detalhe da instituição', { skip: !rodar }, () => {
  test('monta os cards da tela e mostra quem cadastrou', async () => {
    const criada = await criarInstituicao(gestor, instituicaoValida({
      cnpj: CNPJ_B, nome: `Detalhe ${MARCA}`, email: `det.${MARCA}@exemplo.br`,
    }));
    anotarInstituicao(criada.id);

    const d = await obterInstituicao(gestor, criada.id);

    assert.equal(d.endereco.cep, '85000000', 'CEP guardado só com dígitos');
    assert.equal(d.endereco.estado, 'PR');
    assert.equal(d.cnpjFormatado, '11.444.777/0001-61');
    assert.ok(d.classificacao.tipo, 'o nome do tipo deveria vir resolvido');
    assert.ok(d.classificacao.area, 'o nome da área deveria vir resolvido');

    // Este é o teste da vw_usuario_publico: o gestor não pode LER a linha de
    // outro usuário na tabela usuario, mas a tela precisa do nome do autor.
    assert.equal(d.cadastro.criadoPor, gestor.nome,
      'um gestor deveria enxergar o nome de quem cadastrou');

    assert.equal(d.participacao.mediaPresenca, null,
      'instituição nova não tem média de presença, e não 0%');
    assert.deepEqual(d.representantes, []);
  });

  test('id inexistente devolve 404, não erro interno', async () => {
    await assert.rejects(
      () => obterInstituicao(gestor, '00000000-0000-0000-0000-000000000000'),
      (/** @type {any} */ e) => e.codigo === 'NAO_ENCONTRADO' && e.status === 404,
    );
  });
});

// ------------------------------------------------------------------- edição
describe('edição e situação', { skip: !rodar }, () => {
  /** @type {string} */ let id;

  before(async () => {
    if (!rodar) return;
    const c = await criarInstituicao(gestor, instituicaoValida({
      nome: `Edicao ${MARCA}`,
      cnpj: gerarCnpj(),
      email: `ed.${MARCA}@exemplo.br`,
    }));
    id = anotarInstituicao(c.id);
  });

  test('altera só o campo enviado', async () => {
    const antes = await obterInstituicao(gestor, id);
    await editarInstituicao(gestor, id, { telefone: '(42) 99999-1234' });
    const depois = await obterInstituicao(gestor, id);

    assert.equal(depois.telefone, '(42) 99999-1234');
    assert.equal(depois.nome, antes.nome, 'o nome não deveria ter mudado');
    assert.equal(depois.endereco.bairro, antes.endereco.bairro);
    assert.equal(depois.cadastro.atualizadoPor, gestor.nome);
  });

  test('corpo vazio é recusado em vez de fingir que salvou', async () => {
    await assert.rejects(
      () => editarInstituicao(gestor, id, {}),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('inativar sem data de saída aponta o campo que falta', async () => {
    await assert.rejects(
      () => editarInstituicao(gestor, id, { status: 'inativa' }),
      (/** @type {any} */ e) => e.codigo === 'DATA_SAIDA_OBRIGATORIA' && e.status === 422,
    );
  });

  test('desativar preenche a data sozinho e registra no histórico', async () => {
    const r = await alterarStatusInstituicao(gestor, id, { status: 'inativa' });
    assert.equal(r.status, 'inativa');
    assert.ok(r.dataSaida, 'a data de saída deveria ter sido preenchida com hoje');

    const { rows } = await db.query(
      `select status_anterior, status_novo from instituicao_status_historico
        where instituicao_id = $1 order by alterado_em desc limit 1`, [id],
    );
    assert.equal(rows[0].status_novo, 'inativa',
      'a trigger deveria ter gravado a troca de situação');
  });

  test('reativar limpa a data de saída', async () => {
    const r = await alterarStatusInstituicao(gestor, id, { status: 'ativa' });
    assert.equal(r.status, 'ativa');
    assert.equal(r.dataSaida, null,
      'instituição ativa com data de saída faria a listagem mentir');
  });

  test('perfil de consulta não edita', async () => {
    await assert.rejects(
      () => editarInstituicao(leitura, id, { telefone: '(42) 0000-0000' }),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
  });
});

// ----------------------------------------------------------------- exclusão
describe('exclusão', { skip: !rodar }, () => {
  test('cadastro sem histórico pode ser excluído pelo admin', async () => {
    const c = await criarInstituicao(admin, instituicaoValida({
      nome: `Engano ${MARCA}`, cnpj: gerarCnpj(),
      email: `eng.${MARCA}@exemplo.br`,
    }));
    const r = await excluirInstituicao(admin, c.id);
    assert.equal(r.excluida, true);

    await assert.rejects(
      () => obterInstituicao(admin, c.id),
      (/** @type {any} */ e) => e.codigo === 'NAO_ENCONTRADO',
    );
  });

  test('gestor não exclui, mesmo sem histórico', async () => {
    const c = await criarInstituicao(gestor, instituicaoValida({
      nome: `SoAdmin ${MARCA}`, cnpj: gerarCnpj(), email: `sa.${MARCA}@exemplo.br`,
    }));
    anotarInstituicao(c.id);

    await assert.rejects(
      () => excluirInstituicao(gestor, c.id),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );

    // O que importa não é a exceção, é o EFEITO: a linha continua lá.
    const ainda = await obterInstituicao(gestor, c.id);
    assert.equal(ainda.id, c.id, 'a instituição não podia ter sumido');
  });

  test('instituição com vínculo é protegida e sugere desativar', async () => {
    const c = await criarInstituicao(gestor, instituicaoValida({
      nome: `ComVinculo ${MARCA}`, cnpj: gerarCnpj(), email: `cv.${MARCA}@exemplo.br`,
    }));
    anotarInstituicao(c.id);

    const rep = await criarRepresentante(gestor, {
      nome: `Pessoa Vinculada ${MARCA}`,
      email: `pv.${MARCA}@exemplo.br`,
      vinculo: { instituicaoId: c.id, cargo: 'Coordenador' },
    });
    pessoasCriadas.push(rep.pessoaId);

    await assert.rejects(
      () => excluirInstituicao(admin, c.id),
      (/** @type {any} */ e) => {
        assert.equal(e.codigo, 'INSTITUICAO_COM_VINCULO');
        assert.equal(e.status, 409, 'é conflito de estado, não falta de permissão');
        assert.equal(e.extra?.acaoSugerida, 'desativar');
        return true;
      },
    );
  });
});

// ----------------------------------------------------- representante e vínculo
describe('representante e vínculo', { skip: !rodar }, () => {
  /** @type {string} */ let instId;

  before(async () => {
    if (!rodar) return;
    const c = await criarInstituicao(gestor, instituicaoValida({
      nome: `Reps ${MARCA}`, cnpj: gerarCnpj(), email: `reps.${MARCA}@exemplo.br`,
    }));
    instId = anotarInstituicao(c.id);
  });

  test('cadastra pessoa e vínculo numa transação só', async () => {
    const r = await criarRepresentante(gestor, {
      nome: `Maria Teste ${MARCA}`,
      email: `maria.${MARCA}@exemplo.br`,
      telefone: '(42) 98888-0000',
      vinculo: { instituicaoId: instId, cargo: 'Pró-reitora' },
    });
    pessoasCriadas.push(r.pessoaId);

    assert.ok(r.vinculo, 'o vínculo deveria ter sido criado junto');
    assert.equal(r.vinculo.cargo, 'Pró-reitora');
    assert.equal(r.vinculo.status, 'ativo');

    const d = await obterInstituicao(gestor, instId);
    assert.equal(d.representantesAtivos, 1,
      'o representante deveria aparecer na aba da instituição');
  });

  test('vínculo repetido na mesma instituição é recusado', async () => {
    const { rows } = await db.query(
      'select id from pessoa where email = $1', [`maria.${MARCA}@exemplo.br`],
    );
    await assert.rejects(
      () => criarVinculo(gestor, { pessoaId: rows[0].id, instituicaoId: instId }),
      (/** @type {any} */ e) => e.codigo === 'VINCULO_DUPLICADO' && e.status === 409,
    );
  });

  test('mesmo e-mail reaproveita a pessoa em vez de duplicar', async () => {
    const outra = await criarInstituicao(gestor, instituicaoValida({
      nome: `Segunda ${MARCA}`, cnpj: gerarCnpj(), email: `seg.${MARCA}@exemplo.br`,
    }));
    anotarInstituicao(outra.id);

    const r = await criarRepresentante(gestor, {
      nome: `Maria Teste ${MARCA}`,
      email: `maria.${MARCA}@exemplo.br`,
      vinculo: { instituicaoId: outra.id, cargo: 'Diretora' },
    });

    const { rows } = await db.query(
      'select count(*)::int as n from pessoa where email = $1',
      [`maria.${MARCA}@exemplo.br`],
    );
    assert.equal(rows[0].n, 1, 'trocar de instituição não pode duplicar a pessoa');
    assert.equal(r.vinculo?.cargo, 'Diretora');
  });

  test('instituição inexistente devolve 404', async () => {
    await assert.rejects(
      () => criarRepresentante(gestor, {
        nome: `Fantasma ${MARCA}`,
        vinculo: { instituicaoId: '00000000-0000-0000-0000-000000000000' },
      }),
      (/** @type {any} */ e) => e.codigo === 'NAO_ENCONTRADO',
    );
  });
});

// -------------------------------------------------------- domínios e dashboard
describe('domínios e indicadores', { skip: !rodar }, () => {
  test('os selects do formulário vêm preenchidos', async () => {
    const d = await listarDominios(leitura);
    assert.ok(d.tiposInstituicao.length >= 8, 'os tipos da carga inicial deveriam estar lá');
    assert.ok(d.areasAtuacao.length >= 9, 'as áreas da migration 002 deveriam estar lá');
    assert.equal(d.statusInstituicao.length, 4);
  });

  test('o dashboard responde com a forma que a tela espera', async () => {
    const d = await obterDashboard(leitura);
    assert.equal(typeof d.cartoes.instituicoes.ativas, 'number');
    assert.equal(typeof d.cartoes.representantesAtivos, 'number');
    assert.ok(Array.isArray(d.evolucaoParticipacao));
    assert.ok(Array.isArray(d.participacaoPorInstituicao));
    assert.ok(Array.isArray(d.proximasReunioes));
  });

  test('perfil de consulta enxerga indicador mas não escreve', async () => {
    await assert.rejects(
      () => criarInstituicao(leitura, instituicaoValida({ cnpj: gerarCnpj() })),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
  });
});

// ---------------------------------------------------------------- utilidades
/**
 * Gera um CNPJ com dígito verificador correto, para os testes não dependerem de
 * uma lista fixa de números válidos escritos à mão.
 *
 * @returns {string}
 */
function gerarCnpj() {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');

  /** @param {string} parcial @param {number[]} pesos */
  const digito = (parcial, pesos) => {
    const soma = parcial.split('').reduce((a, n, i) => a + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = digito(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}
