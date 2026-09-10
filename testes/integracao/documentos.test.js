/**
 * Testes de integração do Bloco C — upload de documentos.
 *
 *   DATABASE_URL=postgresql://app_web:...@localhost:5432/ecossistema \
 *   DATABASE_URL_ADMIN=postgresql://postgres:...@localhost:5432/ecossistema \
 *   npm run test:integracao
 *
 * O que estes testes provam e os testes SQL não provam: que os bytes voltam
 * idênticos depois de passar pela aplicação, e que um arquivo renomeado não
 * entra só porque a extensão diz que ele é outra coisa.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { fecharPool } from '@/infraestrutura/banco/pool.js';

import { enviarDocumento } from '@/aplicacao/documentos/enviar-documento.js';
import { listarDocumentos } from '@/aplicacao/documentos/listar-documentos.js';
import { baixarDocumento } from '@/aplicacao/documentos/baixar-documento.js';
import { removerDocumento } from '@/aplicacao/documentos/remover-documento.js';
import { criarInstituicao } from '@/aplicacao/instituicoes/criar-instituicao.js';
import { excluirInstituicao } from '@/aplicacao/instituicoes/excluir-instituicao.js';
import { obterInstituicao } from '@/aplicacao/instituicoes/obter-instituicao.js';
import { criarReuniao } from '@/aplicacao/reunioes/criar-reuniao.js';
import { LIMITE_BYTES } from '@/dominio/arquivos.js';

const { Client } = pg;

const URL_APP = process.env.DATABASE_URL ?? '';
const URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const rodar = URL_APP.length > 0 && URL_ADMIN.length > 0;

/** @type {import('pg').Client} */
let db;
const MARCA = `d${Date.now()}`;

/** @type {any} */ let admin;
/** @type {any} */ let gestor;
/** @type {any} */ let leitura;
/** @type {string} */ let instId;
/** @type {string} */ let reuniaoId;

/** Um PDF de verdade em miniatura: assinatura %PDF seguida de bytes binários. */
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]),
  Buffer.from('\n%%EOF\n'),
]);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('conteudo qualquer'),
]);

function gerarCnpj() {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');
  /** @param {string} p @param {number[]} w */
  const d = (p, w) => {
    const s = p.split('').reduce((a, n, i) => a + Number(n) * w[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  const d1 = d(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = d(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

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

  const inst = await criarInstituicao(gestor, {
    nome: `Instituicao ${MARCA}`, cnpj: gerarCnpj(), dataFundacao: '2000-01-01',
    status: 'ativa', telefone: '(42) 3333-3333', logradouro: 'Rua A', bairro: 'Centro',
    cidade: 'Guarapuava', estado: 'PR', cep: '85000000',
    tipoInstituicaoId: t[0].id, areaAtuacaoId: a[0].id,
    email: `inst.${MARCA}@exemplo.br`,
  });
  instId = inst.id;

  const r = await criarReuniao(gestor, {
    titulo: `Reuniao ${MARCA}`,
    data: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  });
  reuniaoId = r.id;
});

after(async () => {
  if (!rodar) return;
  await db.query('delete from documento where instituicao_id = $1', [instId]);
  await db.query('delete from documento where reuniao_id = $1', [reuniaoId]);
  await db.query('delete from reuniao where id = $1', [reuniaoId]);
  await db.query('delete from instituicao where id = $1', [instId]);
  await db.query('delete from usuario where email like $1', [`%.${MARCA}@exemplo.br`]);
  await db.end();
  // Sem isto o processo fica 30 segundos de pé esperando o pool ocioso.
  await fecharPool();
});

// ------------------------------------------------------------------- arquivo
describe('envio de arquivo', { skip: !rodar }, () => {
  /** @type {string} */ let docId;

  test('envia PDF e os bytes voltam idênticos', async () => {
    const r = await enviarDocumento(gestor, {
      campos: { instituicaoId: instId, descricao: 'Relatório de visitação' },
      arquivo: { nome: 'Relatório de Visitação.pdf', mime: 'application/pdf', conteudo: PDF },
    });
    docId = r.id;

    assert.equal(r.origem, 'arquivo');
    assert.equal(r.tamanhoBytes, PDF.length);
    assert.equal(r.checksum, createHash('sha256').update(PDF).digest('hex'));
    assert.equal(r.jaExistia, false);

    const baixado = await baixarDocumento(gestor, docId);
    assert.ok(baixado.conteudo.equals(PDF),
      'os bytes baixados precisam ser byte a byte os mesmos que subiram');
    assert.equal(baixado.mimeType, 'application/pdf');
  });

  test('o nome do arquivo é sanitizado no caminho de armazenamento', async () => {
    const { rows } = await db.query(
      'select storage_path, nome from documento where id = $1', [docId],
    );
    const caminho = rows[0].storage_path;

    assert.ok(caminho.startsWith(`instituicao/${instId}/`), `caminho inesperado: ${caminho}`);
    assert.ok(!/[çãáéíóúÇÃ ]/.test(caminho), 'o caminho não pode ter acento nem espaço');
    // O nome visível para o usuário mantém a acentuação; quem é sanitizado é o
    // caminho, que vira chave de armazenamento.
    assert.match(rows[0].nome, /Visita/);
  });

  test('aparece na listagem e no detalhe da instituição', async () => {
    const lista = await listarDocumentos(gestor, { instituicaoId: instId });
    assert.equal(lista.total, 1);
    assert.equal(lista.dados[0].origem, 'arquivo');
    assert.equal(lista.dados[0].enviadoPor, gestor.nome);
    assert.equal(lista.dados[0].urlExterna, null);

    const detalhe = await obterInstituicao(gestor, instId);
    assert.equal(detalhe.documentos.length, 1);
    assert.equal(detalhe.documentos[0].id, docId);
    assert.equal(detalhe.documentos[0].origem, 'arquivo');
  });

  test('reenviar o mesmo arquivo devolve o que já existe, sem duplicar', async () => {
    const r = await enviarDocumento(gestor, {
      campos: { instituicaoId: instId },
      arquivo: { nome: 'outro-nome.pdf', mime: 'application/pdf', conteudo: PDF },
    });

    assert.equal(r.jaExistia, true);
    assert.equal(r.id, docId, 'deveria devolver o documento anterior');

    const lista = await listarDocumentos(gestor, { instituicaoId: instId });
    assert.equal(lista.total, 1, 'clicar duas vezes em enviar não pode criar duas cópias');
  });

  test('caminho de armazenamento não colide entre arquivos diferentes', async () => {
    const r = await enviarDocumento(gestor, {
      campos: { instituicaoId: instId },
      arquivo: { nome: 'Relatório de Visitação.pdf', mime: 'image/png', conteudo: PNG },
    });

    const { rows } = await db.query(
      'select storage_path from documento where instituicao_id = $1', [instId],
    );
    const caminhos = rows.map((/** @type {any} */ l) => l.storage_path);
    assert.equal(new Set(caminhos).size, caminhos.length,
      'dois arquivos de mesmo nome não podem gerar o mesmo caminho');

    await db.query('delete from documento where id = $1', [r.id]);
  });
});

// -------------------------------------------------------------- recusas
describe('arquivos recusados', { skip: !rodar }, () => {
  test('HTML disfarçado de PDF é recusado', async () => {
    // O caso que a conferência dos bytes existe para pegar: extensão e mime
    // dizem PDF, o conteúdo é HTML com script. Servido do mesmo domínio, isso
    // rodaria na sessão de quem abrisse.
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: instId },
        arquivo: {
          nome: 'inocente.pdf',
          mime: 'application/pdf',
          conteudo: Buffer.from('<html><script>alert(document.cookie)</script></html>'),
        },
      }),
      (/** @type {any} */ e) => {
        assert.equal(e.codigo, 'TIPO_NAO_PERMITIDO');
        assert.equal(e.status, 415);
        return true;
      },
    );
  });

  test('tipo fora da lista é recusado mesmo com conteúdo coerente', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: instId },
        arquivo: {
          nome: 'pagina.html', mime: 'text/html',
          conteudo: Buffer.from('<html>oi</html>'),
        },
      }),
      (/** @type {any} */ e) => e.codigo === 'TIPO_NAO_PERMITIDO',
    );
  });

  test('SVG é recusado — carrega script', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: instId },
        arquivo: {
          nome: 'logo.svg', mime: 'image/svg+xml',
          conteudo: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        },
      }),
      (/** @type {any} */ e) => e.codigo === 'TIPO_NAO_PERMITIDO',
    );
  });

  test('arquivo acima do limite é recusado', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: instId },
        arquivo: {
          nome: 'enorme.pdf', mime: 'application/pdf',
          conteudo: Buffer.concat([Buffer.from('%PDF-1.7\n'),
            Buffer.alloc(LIMITE_BYTES + 1024)]),
        },
      }),
      (/** @type {any} */ e) => {
        assert.equal(e.codigo, 'ARQUIVO_GRANDE_DEMAIS');
        assert.equal(e.status, 413);
        assert.equal(e.extra?.limiteBytes, LIMITE_BYTES);
        return true;
      },
    );
  });

  test('arquivo vazio é recusado', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: instId },
        arquivo: { nome: 'vazio.pdf', mime: 'application/pdf', conteudo: Buffer.alloc(0) },
      }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('documento precisa de exatamente um dono', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: {},
        arquivo: { nome: 'orfao.pdf', mime: 'application/pdf', conteudo: PDF },
      }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );

    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: instId, reuniaoId },
        arquivo: { nome: 'dois-donos.pdf', mime: 'application/pdf', conteudo: PDF },
      }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('instituição inexistente devolve 404, não erro de chave estrangeira', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: '00000000-0000-0000-0000-000000000000' },
        arquivo: { nome: 'a.pdf', mime: 'application/pdf', conteudo: PDF },
      }),
      (/** @type {any} */ e) => e.codigo === 'NAO_ENCONTRADO' && e.status === 404,
    );
  });

  test('perfil de consulta não anexa', async () => {
    await assert.rejects(
      () => enviarDocumento(leitura, {
        campos: { instituicaoId: instId },
        arquivo: { nome: 'a.pdf', mime: 'application/pdf', conteudo: PDF },
      }),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );
  });
});

// ---------------------------------------------------------------- link externo
describe('documento por link', { skip: !rodar }, () => {
  /** @type {string} */ let linkId;

  test('registra link do Drive sem arquivo nenhum', async () => {
    const r = await enviarDocumento(gestor, {
      campos: {
        reuniaoId,
        nome: 'Ata no Drive',
        urlExterna: 'https://drive.google.com/file/d/abc123/view',
      },
      arquivo: null,
    });
    linkId = r.id;

    assert.equal(r.origem, 'link');

    const lista = await listarDocumentos(gestor, { reuniaoId });
    assert.equal(lista.dados[0].origem, 'link');
    assert.equal(lista.dados[0].tamanhoBytes, null, 'link não tem tamanho');
  });

  test('baixar um link diz que ele não está guardado aqui', async () => {
    await assert.rejects(
      () => baixarDocumento(gestor, linkId),
      (/** @type {any} */ e) => {
        assert.equal(e.codigo, 'DOCUMENTO_E_LINK');
        assert.ok(e.extra?.urlExterna, 'o erro deveria trazer a URL para a tela abrir');
        return true;
      },
    );
  });

  test('link que não é http é recusado', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { reuniaoId, urlExterna: 'javascript:alert(document.cookie)' },
        arquivo: null,
      }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });

  test('arquivo e link ao mesmo tempo é recusado', async () => {
    await assert.rejects(
      () => enviarDocumento(gestor, {
        campos: { instituicaoId: instId, urlExterna: 'https://exemplo.br/a.pdf' },
        arquivo: { nome: 'a.pdf', mime: 'application/pdf', conteudo: PDF },
      }),
      (/** @type {any} */ e) => e.codigo === 'DADOS_INVALIDOS',
    );
  });
});

// -------------------------------------------------------------------- remoção
describe('remoção', { skip: !rodar }, () => {
  test('gestor não remove; a linha continua lá', async () => {
    const lista = await listarDocumentos(gestor, { instituicaoId: instId });
    const id = lista.dados[0].id;

    await assert.rejects(
      () => removerDocumento(gestor, id),
      (/** @type {any} */ e) => e.codigo === 'SEM_PERMISSAO',
    );

    const depois = await listarDocumentos(gestor, { instituicaoId: instId });
    assert.equal(depois.total, lista.total, 'nada podia ter sido removido');
  });

  test('instituição com documento não pode ser excluída', async () => {
    await assert.rejects(
      () => excluirInstituicao(admin, instId),
      (/** @type {any} */ e) => e.codigo === 'INSTITUICAO_COM_DOCUMENTO'
        || e.codigo === 'INSTITUICAO_COM_HISTORICO',
    );
  });

  test('admin remove e os bytes somem junto', async () => {
    const lista = await listarDocumentos(admin, { instituicaoId: instId });
    const id = lista.dados[0].id;

    const r = await removerDocumento(admin, id);
    assert.equal(r.removido, true);

    const { rows } = await db.query(
      'select count(*)::int as n from documento_conteudo where documento_id = $1', [id],
    );
    assert.equal(rows[0].n, 0, 'o conteúdo não pode ficar órfão no banco');

    const depois = await listarDocumentos(admin, { instituicaoId: instId });
    assert.equal(depois.total, 0);
  });
});
