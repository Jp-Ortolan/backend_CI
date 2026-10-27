/**
 * Tabela de rotas do contrato /api/governanca (docs/13-contrato-governanca.md).
 *
 * Uma rota catch-all do Next (app/api/governanca/[...caminho]/route.js) entrega
 * o caminho aqui; cada linha diz método, padrão e o que fazer. Os casos de uso
 * são os de src/aplicacao — esta camada só lê a requisição e monta o envelope
 * do contrato (`versao: 1`, `confirmado: true` nas mutações).
 *
 * Linhas são acrescentadas pelos módulos (registrar), na ordem: o primeiro
 * padrão que bater vence.
 */
import { ErroDeNegocio } from '@/dominio/erros.js';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { falha } from './resposta.js';
import { baseDaApi } from './governanca.js';

/**
 * @typedef {object} Contexto
 * @property {import('next/server').NextRequest} req
 * @property {Record<string, string>} p          parâmetros do padrão (:id ...)
 * @property {string} base                       endereço público da API
 * @property {URLSearchParams} consulta
 * @property {() => Promise<any>} usuario        sessão (null sem login)
 * @property {() => Promise<any>} json           corpo JSON ({} se vazio)
 * @property {(limite: number) => Promise<{ campos: Record<string, string>, arquivo: { nome: string, mime: string, conteudo: Buffer }|null }>} multipart
 */

/** @typedef {(ctx: Contexto) => Promise<Response>} Manipulador */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @type {{ metodo: string, partes: string[], fazer: Manipulador }[]} */
const ROTAS = [];

/**
 * @param {string} metodo
 * @param {string} padrao  ex.: "instituicoes/:id/governanca"
 * @param {Manipulador} fazer
 */
export function registrar(metodo, padrao, fazer) {
  ROTAS.push({ metodo, partes: padrao.split('/').filter(Boolean), fazer });
}

/** @param {string[]} partes @param {string[]} caminho */
function casar(partes, caminho) {
  if (partes.length !== caminho.length) return null;
  /** @type {Record<string, string>} */
  const p = {};
  for (let i = 0; i < partes.length; i += 1) {
    if (partes[i].startsWith(':')) p[partes[i].slice(1)] = decodeURIComponent(caminho[i]);
    else if (partes[i] !== caminho[i]) return null;
  }
  return p;
}

/**
 * @param {import('next/server').NextRequest} req
 * @param {string[]} caminho
 */
export async function despachar(req, caminho) {
  try {
    let metodoExiste = false;
    for (const r of ROTAS) {
      const p = casar(r.partes, caminho);
      if (!p) continue;
      metodoExiste = true;
      if (r.metodo !== req.method) continue;
      // Id que nem é um UUID não existe — e não deve chegar ao banco como erro 500.
      if (p.id !== undefined && !UUID.test(p.id)) throw new ErroDeNegocio('NAO_ENCONTRADO', 'Registro não encontrado.');

      /** @type {any} */ let sessao;
      /** @type {Contexto} */
      const ctx = {
        req,
        p,
        base: baseDaApi(req),
        consulta: req.nextUrl.searchParams,
        usuario: async () => {
          if (sessao === undefined) sessao = await usuarioAtual();
          return sessao;
        },
        json: async () => {
          const texto = await req.text();
          if (!texto.trim()) return {};
          try { return JSON.parse(texto); } catch {
            throw new ErroDeNegocio('DADOS_INVALIDOS', 'O corpo da requisição não é um JSON válido.');
          }
        },
        multipart: (limite) => lerMultipart(req, limite),
      };
      return await r.fazer(ctx);
    }
    throw new ErroDeNegocio('NAO_ENCONTRADO',
      metodoExiste ? 'Operação não disponível neste endereço.' : 'Recurso não encontrado.');
  } catch (e) {
    return falha(e);
  }
}

/**
 * @param {import('next/server').NextRequest} req
 * @param {number} limite  bytes
 */
async function lerMultipart(req, limite) {
  const tipo = req.headers.get('content-type') ?? '';
  if (!tipo.includes('multipart/form-data')) {
    throw new ErroDeNegocio('DADOS_INVALIDOS', 'Envie o arquivo como multipart/form-data, no campo "arquivo".');
  }
  const tamanho = Number(req.headers.get('content-length') ?? 0);
  // Folga para os cabeçalhos do multipart.
  if (tamanho && tamanho > limite + 64 * 1024) {
    throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS', 'O arquivo passa do limite permitido.',
      { limiteBytes: limite, recebidoBytes: tamanho });
  }
  const form = await req.formData();
  const enviado = form.get('arquivo');
  /** @type {{ nome: string, mime: string, conteudo: Buffer }|null} */
  let arquivo = null;
  if (enviado && typeof enviado !== 'string') {
    if (enviado.size > limite) {
      throw new ErroDeNegocio('ARQUIVO_GRANDE_DEMAIS', 'O arquivo passa do limite permitido.',
        { limiteBytes: limite, recebidoBytes: enviado.size });
    }
    arquivo = {
      nome: enviado.name || 'arquivo',
      mime: enviado.type || 'application/octet-stream',
      conteudo: Buffer.from(await enviado.arrayBuffer()),
    };
  }
  const campos = Object.fromEntries([...form.entries()]
    .filter(([k, v]) => k !== 'arquivo' && typeof v === 'string'));
  return { campos: /** @type {Record<string, string>} */ (campos), arquivo };
}
