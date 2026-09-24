/**
 * Regras de arquivo: o que o sistema aceita receber.
 * Confere tipo permitido, conteúdo x tipo declarado e nome seguro.
 */

/** 20 MB. Cabe relatório digitalizado; não cabe vídeo. */
export const LIMITE_BYTES = Number(process.env.UPLOAD_LIMITE_BYTES ?? 20 * 1024 * 1024);

/**
 * Tipos aceitos e as assinaturas que provam o conteúdo.
 * HTML e SVG ficam de fora de propósito: podem carregar script.
 * `assinaturas` é uma lista de [posição, bytes em hex]; vazia = texto puro.
 *
 * @type {Record<string, { rotulo: string, extensoes: string[],
 *                         assinaturas: [number, string][] }>}
 */
export const TIPOS_PERMITIDOS = {
  'application/pdf': {
    rotulo: 'PDF', extensoes: ['pdf'],
    assinaturas: [[0, '25504446']], // %PDF
  },
  'image/png': {
    rotulo: 'Imagem PNG', extensoes: ['png'],
    assinaturas: [[0, '89504e470d0a1a0a']],
  },
  'image/jpeg': {
    rotulo: 'Imagem JPEG', extensoes: ['jpg', 'jpeg'],
    assinaturas: [[0, 'ffd8ff']],
  },
  'image/gif': {
    rotulo: 'Imagem GIF', extensoes: ['gif'],
    assinaturas: [[0, '474946383761'], [0, '474946383961']], // GIF87a / GIF89a
  },
  'image/webp': {
    // RIFF nos bytes 0-3 e WEBP nos bytes 8-11.
    rotulo: 'Imagem WebP', extensoes: ['webp'],
    assinaturas: [[0, '52494646'], [8, '57454250']],
  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    rotulo: 'Word (.docx)', extensoes: ['docx'],
    assinaturas: [[0, '504b0304']], // é um zip
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    rotulo: 'Excel (.xlsx)', extensoes: ['xlsx'],
    assinaturas: [[0, '504b0304']],
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    rotulo: 'PowerPoint (.pptx)', extensoes: ['pptx'],
    assinaturas: [[0, '504b0304']],
  },
  'application/msword': {
    rotulo: 'Word antigo (.doc)', extensoes: ['doc'],
    assinaturas: [[0, 'd0cf11e0a1b11ae1']], // OLE2
  },
  'application/vnd.ms-excel': {
    rotulo: 'Excel antigo (.xls)', extensoes: ['xls'],
    assinaturas: [[0, 'd0cf11e0a1b11ae1']],
  },
  'application/vnd.ms-powerpoint': {
    rotulo: 'PowerPoint antigo (.ppt)', extensoes: ['ppt'],
    assinaturas: [[0, 'd0cf11e0a1b11ae1']],
  },
  'text/plain': { rotulo: 'Texto', extensoes: ['txt'], assinaturas: [] },
  'text/csv': { rotulo: 'CSV', extensoes: ['csv'], assinaturas: [] },
};

/** Extensões aceitas, para o `accept` do input file na tela. */
export const EXTENSOES_ACEITAS = Object.values(TIPOS_PERMITIDOS)
  .flatMap((t) => t.extensoes).map((e) => `.${e}`);

/**
 * Extensão em minúsculas, sem o ponto. String vazia se não houver.
 *
 * @param {string} nome
 * @returns {string}
 */
export function extensaoDe(nome) {
  const partes = String(nome ?? '').split('.');
  return partes.length > 1 ? partes.pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

/**
 * Deixa o nome seguro para virar parte de um caminho.
 *
 * Tira diretório, acento, espaço e tudo que não seja letra, número, ponto,
 * hífen ou sublinhado. Limita o comprimento e nunca devolve vazio.
 *
 * @param {string} nome
 * @returns {string}
 */
export function sanitizarNome(nome) {
  const so = String(nome ?? '')
// Barra vira sublinhado: impede nome do tipo ../../etc/senha.
    .replace(/[\\/]/g, '_')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
    .replace(/^[.]+/, '')          // nome começando com ponto vira oculto
    .replace(/[.]{2,}/g, '.')
    .slice(0, 120);

  return so.length ? so : 'arquivo';
}

/**
 * O conteúdo bate com o tipo declarado?
 * O mime do navegador vem da extensão, então é palpite; os bytes é que provam.
 * Texto puro não tem assinatura: o critério é não ter byte nulo.
 *
 * @param {Buffer|Uint8Array} conteudo
 * @param {string} mime
 * @returns {boolean}
 */
export function conteudoBateComTipo(conteudo, mime) {
  const tipo = TIPOS_PERMITIDOS[mime];
  if (!tipo) return false;

  const bytes = Buffer.from(conteudo);

  if (tipo.assinaturas.length === 0) {
    // Texto: nenhum byte nulo nos primeiros 8 KB.
    return !bytes.subarray(0, 8192).includes(0);
  }

// Assinaturas todas na posição 0 são alternativas: basta uma bater.
// WebP tem duas em posições diferentes, então precisa das duas.
  const todasNaPosicaoZero = tipo.assinaturas.every(([pos]) => pos === 0);

  const confere = ([pos, hex]) => {
    const esperado = Buffer.from(hex, 'hex');
    return bytes.subarray(pos, pos + esperado.length).equals(esperado);
  };

  return todasNaPosicaoZero
    ? tipo.assinaturas.some(confere)
    : tipo.assinaturas.every(confere);
}

/**
 * Monta a chave do arquivo no armazenamento.
 * O id no meio evita colisão de nomes iguais e impede adivinhar o caminho.
 *
 * @param {'instituicao'|'reuniao'} dono
 * @param {string} donoId
 * @param {string} documentoId
 * @param {string} nomeArquivo
 * @returns {string}
 */
export function montarCaminho(dono, donoId, documentoId, nomeArquivo) {
  return `${dono}/${donoId}/${documentoId}-${sanitizarNome(nomeArquivo)}`;
}

/**
 * Tamanho legível, para mensagem de erro e para a tela.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function tamanhoLegivel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
