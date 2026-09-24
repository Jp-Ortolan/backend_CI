/**
 * Endereços do front-end.
 *
 * O front é outro projeto e outro deploy. Três coisas daqui apontam para ele:
 * a origem liberada no CORS, a URL dentro do QR Code e o link de recuperação.
 *
 * `URL_FRONTEND` aceita mais de um endereço, separados por vírgula: na prática
 * são sempre dois ao mesmo tempo — o Vite da máquina de quem desenvolve e o
 * endereço publicado. Com um só, ligar a produção desligaria o ambiente local.
 *
 * `NEXT_PUBLIC_APP_URL` continua aceita como nome antigo.
 */

const semBarraFinal = (u) => u.trim().replace(/\/+$/, '');

const CONFIGURADOS = (process.env.URL_FRONTEND ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000')
  .split(',')
  .map(semBarraFinal)
  .filter(Boolean);

/**
 * O endereço principal — o primeiro da lista. É o usado para montar link:
 * o QR Code e o e-mail de recuperação precisam de um endereço só, e o de
 * produção vem primeiro.
 *
 * @returns {string} sem barra no fim
 */
export function urlDoFront() {
  return CONFIGURADOS[0];
}

/**
 * A origem pode ser liberada no CORS? Só as configuradas passam.
 *
 * @param {string|null} origem  o cabeçalho Origin da requisição
 * @returns {string} a origem, se liberada; '' se não
 */
export function origemLiberada(origem) {
  return origem && CONFIGURADOS.includes(semBarraFinal(origem)) ? origem : '';
}
