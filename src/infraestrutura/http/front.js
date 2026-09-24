/**
 * Endereço público do front-end.
 *
 * O front é outro projeto e outro deploy, mas duas coisas que saem daqui
 * apontam para ele: a URL dentro do QR Code e o link de recuperação de senha.
 * Por isso o endereço é configuração de ambiente, e não valor fixo.
 *
 * `NEXT_PUBLIC_APP_URL` é aceita como nome antigo, para não quebrar ambientes
 * já configurados.
 *
 * @returns {string} sem barra no fim
 */
export function urlDoFront() {
  const base = process.env.URL_FRONTEND
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}
