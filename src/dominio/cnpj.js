/**
 * CNPJ: normaliza e valida o dígito verificador.
 * Guardamos sempre só os dígitos — a pontuação é decoração de tela.
 */

/**
 * Tira tudo que não é dígito.
 *
 * @param {string|null|undefined} valor
 * @returns {string}
 */
export function apenasDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/**
 * O CNPJ é válido?
 *
 * @param {string|null|undefined} valor  com ou sem pontuação
 * @returns {boolean}
 */
export function cnpjValido(valor) {
  const cnpj = apenasDigitos(valor);
  if (cnpj.length !== 14) return false;

// Dígitos todos iguais passam na conta por coincidência: recusa na mão.
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  /**
   * @param {string} base
   * @param {number[]} pesos
   */
  const digito = (base, pesos) => {
    const soma = base
      .split('')
      .reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = digito(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

/**
 * Formata para exibição: 12345678000195 → 12.345.678/0001-95
 *
 * Só para tela e relatório. O que vai para o banco é sempre `apenasDigitos`.
 *
 * @param {string|null|undefined} valor
 * @returns {string}
 */
export function formatarCnpj(valor) {
  const c = apenasDigitos(valor);
  if (c.length !== 14) return String(valor ?? '');
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

/**
 * CEP: só dígitos, exatamente 8. Mesma lógica do CNPJ — a coluna é char(8).
 *
 * @param {string|null|undefined} valor
 * @returns {boolean}
 */
export function cepValido(valor) {
  return apenasDigitos(valor).length === 8;
}
