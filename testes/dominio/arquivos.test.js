/**
 * Testes das regras de arquivo — puros, sem banco.
 *
 * A sanitização de nome e a conferência dos bytes são as duas peças que
 * impedem que um arquivo enviado vire caminho perigoso ou script servido pelo
 * domínio do sistema. Merecem teste que roda em qualquer máquina, sem depender
 * de banco de pé.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizarNome, extensaoDe, conteudoBateComTipo, montarCaminho,
  tamanhoLegivel, TIPOS_PERMITIDOS, EXTENSOES_ACEITAS,
} from '../../src/dominio/arquivos.js';

test('sanitizarNome remove travessia de diretório', () => {
  const perigosos = [
    '../../etc/passwd',
    '..\\..\\Windows\\System32\\config',
    '/etc/shadow',
  ];
  for (const nome of perigosos) {
    const limpo = sanitizarNome(nome);
    assert.ok(!limpo.includes('/'), `"${limpo}" ainda tem barra`);
    assert.ok(!limpo.includes('\\'), `"${limpo}" ainda tem contrabarra`);
    assert.ok(!limpo.includes('..'), `"${limpo}" ainda tem ".."`);
  }
});

test('sanitizarNome tira acento e espaço, mantendo a extensão', () => {
  assert.equal(sanitizarNome('Relatório de Visitação.pdf'), 'Relatorio-de-Visitacao.pdf');
  assert.equal(sanitizarNome('Ata da Reunião — Março.docx'), 'Ata-da-Reuniao--Marco.docx');
});

test('sanitizarNome nunca devolve vazio nem arquivo oculto', () => {
  assert.equal(sanitizarNome(''), 'arquivo');
  assert.equal(sanitizarNome('...'), 'arquivo');
  assert.equal(sanitizarNome(null), 'arquivo');
  assert.ok(!sanitizarNome('.gitignore').startsWith('.'));
});

test('sanitizarNome limita o comprimento', () => {
  const longo = `${'a'.repeat(500)}.pdf`;
  assert.ok(sanitizarNome(longo).length <= 120);
});

test('extensaoDe normaliza para minúscula', () => {
  assert.equal(extensaoDe('arquivo.PDF'), 'pdf');
  assert.equal(extensaoDe('a.b.c.XlSx'), 'xlsx');
  assert.equal(extensaoDe('sem-extensao'), '');
});

test('assinatura correta é aceita', () => {
  const casos = [
    ['application/pdf', Buffer.from('%PDF-1.7\n...')],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
    ['image/gif', Buffer.from('GIF89a....')],
    ['text/csv', Buffer.from('nome;cnpj\nAlfa;123')],
  ];
  for (const [mime, bytes] of casos) {
    assert.equal(conteudoBateComTipo(bytes, mime), true, `${mime} deveria ser aceito`);
  }
});

test('HTML disfarçado de PDF é recusado', () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  assert.equal(conteudoBateComTipo(html, 'application/pdf'), false);
  assert.equal(conteudoBateComTipo(html, 'image/png'), false);
});

test('tipo fora da lista nunca é aceito, mesmo com conteúdo coerente', () => {
  assert.equal(conteudoBateComTipo(Buffer.from('<html>'), 'text/html'), false);
  assert.equal(conteudoBateComTipo(Buffer.from('<svg>'), 'image/svg+xml'), false);
  assert.equal(conteudoBateComTipo(Buffer.from('MZ'), 'application/x-msdownload'), false);
});

test('webp exige as duas assinaturas, não só RIFF', () => {
  const riffWebp = Buffer.concat([
    Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
  const riffAvi = Buffer.concat([
    Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]);

  assert.equal(conteudoBateComTipo(riffWebp, 'image/webp'), true);
  assert.equal(conteudoBateComTipo(riffAvi, 'image/webp'), false,
    'um AVI começa com RIFF igual ao WebP; só a segunda assinatura separa os dois');
});

test('texto com byte nulo é tratado como binário e recusado', () => {
  assert.equal(conteudoBateComTipo(Buffer.from('linha ok'), 'text/plain'), true);
  assert.equal(conteudoBateComTipo(Buffer.from([0x61, 0x00, 0x62]), 'text/plain'), false);
});

test('os formatos do Office compartilham a assinatura de zip', () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // Os dois passam: .docx e .xlsx são zips, e distinguir um do outro exigiria
  // abrir o pacote. O mime declarado decide, e a lista fechada já garante que
  // qualquer um dos dois é seguro de guardar.
  assert.equal(conteudoBateComTipo(zip, docx), true);
  assert.equal(conteudoBateComTipo(zip, xlsx), true);
});

test('montarCaminho separa por dono e não repete para o mesmo nome', () => {
  const a = montarCaminho('instituicao', 'inst-1', 'doc-a', 'Relatório.pdf');
  const b = montarCaminho('instituicao', 'inst-1', 'doc-b', 'Relatório.pdf');

  assert.notEqual(a, b, 'o id do documento é o que evita colisão de nome igual');
  assert.ok(a.startsWith('instituicao/inst-1/'));
  assert.ok(!/[óç ]/.test(a), 'o caminho não pode carregar acento nem espaço');
});

test('a lista de tipos não deixa entrar nada executável ou renderizável', () => {
  const proibidos = [
    'text/html', 'image/svg+xml', 'application/javascript',
    'application/x-msdownload', 'application/x-sh',
  ];
  for (const mime of proibidos) {
    assert.equal(mime in TIPOS_PERMITIDOS, false, `${mime} não pode estar na lista`);
  }
  assert.ok(EXTENSOES_ACEITAS.includes('.pdf'));
  assert.ok(!EXTENSOES_ACEITAS.includes('.html'));
});

test('tamanhoLegivel arredonda para leitura humana', () => {
  assert.equal(tamanhoLegivel(512), '512 B');
  assert.equal(tamanhoLegivel(2048), '2 KB');
  assert.equal(tamanhoLegivel(1258291), '1.2 MB');
  assert.equal(tamanhoLegivel(null), '0 B');
});
