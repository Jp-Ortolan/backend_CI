/**
 * Regras de arquivo — o que o sistema aceita receber.
 *
 * Três perguntas diferentes, e todas precisam de resposta antes de gravar:
 *   1. o tipo é permitido?
 *   2. o conteúdo é mesmo daquele tipo, ou só o nome diz que é?
 *   3. o nome é seguro para virar caminho de armazenamento?
 *
 * A terceira é a que costuma faltar. Nome de arquivo vem do computador de quem
 * envia, então pode conter `../`, barra, byte nulo ou 300 caracteres — e vira
 * caminho no armazenamento.
 */

/** 20 MB. Cabe relatório digitalizado; não cabe vídeo. */
export const LIMITE_BYTES = Number(process.env.UPLOAD_LIMITE_BYTES ?? 20 * 1024 * 1024);

/**
 * Tipos aceitos, com as assinaturas que provam o conteúdo.
 *
 * NÃO estão na lista, de propósito: `text/html`, `image/svg+xml` e qualquer
 * coisa executável. SVG carrega `<script>`, e HTML é HTML — servidos a partir
 * do mesmo domínio do sistema, viram execução de script na sessão de quem
 * abre. O download forçado já protege, mas um tipo que nunca entra é uma
 * proteção a menos para alguém desfazer sem perceber.
 *
 * `assinaturas` é uma lista de [posição, bytes em hex].
 * Lista vazia = formato sem assinatura (texto puro), conferido de outro jeito.
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
    // `..\\` e `../` viram nada: sem isso, um nome como "../../etc/senha"
    // escaparia da pasta no dia em que o armazenamento for sistema de arquivos.
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
 *
 * O navegador manda o mime a partir da extensão, então ele é palpite, não
 * prova. Conferir os primeiros bytes pega tanto o engano honesto (planilha
 * salva com extensão errada) quanto o arquivo renomeado de propósito.
 *
 * Texto puro não tem assinatura: o critério é não conter byte nulo, que é o
 * que separa texto de binário na prática.
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

  // WebP precisa das DUAS assinaturas (RIFF e WEBP); os outros formatos têm
  // variantes alternativas e basta uma bater. A diferença é essa: quando todas
  // as assinaturas começam na posição 0, são alternativas.
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
 * Monta a chave lógica do arquivo no armazenamento.
 *
 * O uuid no meio evita que dois "relatorio.pdf" da mesma instituição colidam, e
 * evita que alguém adivinhe o caminho de um documento a partir do nome.
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
