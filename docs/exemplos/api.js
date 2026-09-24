/**
 * Cliente da API do Ecossistema de Inovação.
 * Copie para src/services/api.js no projeto do front.
 *
 * Define VITE_API_URL no .env:
 *   VITE_API_URL=http://localhost:3000/api          (local)
 *   VITE_API_URL=https://<seu-app>.up.railway.app/api
 */

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

/** Erro da API, com o código e os campos que o formulário precisa marcar. */
export class ErroDaApi extends Error {
  constructor({ codigo, mensagem, campos, status }) {
    super(mensagem ?? 'Erro inesperado.');
    this.name = 'ErroDaApi';
    this.codigo = codigo ?? 'ERRO';
    this.campos = campos ?? [];
    this.status = status;
  }

  /** { cpf: 'CPF inválido.' } — pronto para o estado de erros do formulário. */
  porCampo() {
    return Object.fromEntries(this.campos.map((c) => [c.campo, c.mensagem]));
  }
}

/** O que fazer quando a sessão cai. Trocar por navigate() do react-router. */
let aoPerderSessao = () => { window.location.href = '/login'; };
export function definirAoPerderSessao(fn) { aoPerderSessao = fn; }

function comQuery(caminho, params) {
  if (!params) return caminho;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${caminho}?${s}` : caminho;
}

async function requisitar(metodo, caminho, { corpo, params } = {}) {
  const resposta = await fetch(BASE + comQuery(caminho, params), {
    method: metodo,
    // Sem isto o cookie de sessão não viaja e tudo volta 401.
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  if (resposta.status === 204) return null;

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const erro = new ErroDaApi({ ...(dados?.erro ?? {}), status: resposta.status });
    // 401 no próprio login é senha errada, não sessão perdida.
    if (resposta.status === 401 && !caminho.startsWith('/sessao')) aoPerderSessao();
    throw erro;
  }

  return dados;
}

export const api = {
  get: (caminho, params) => requisitar('GET', caminho, { params }),
  post: (caminho, corpo) => requisitar('POST', caminho, { corpo }),
  patch: (caminho, corpo) => requisitar('PATCH', caminho, { corpo }),
  del: (caminho) => requisitar('DELETE', caminho),
};

/**
 * Baixar documento: é arquivo, não JSON — por isso fora do `api` acima.
 * @param {string} id
 */
export async function baixarDocumento(id) {
  const r = await fetch(`${BASE}/documentos/${id}/conteudo`, { credentials: 'include' });
  if (!r.ok) throw new ErroDaApi({ status: r.status, mensagem: 'Não foi possível baixar.' });
  return r.blob();
}
