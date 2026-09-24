/**
 * CPF: normaliza e valida o dígito verificador.
 * Mesma regra do CNPJ — guardamos só os dígitos.
 */
import { apenasDigitos } from './cnpj.js';

export { apenasDigitos };

/**
 * O CPF é válido?
 *
 * @param {string|null|undefined} valor  com ou sem pontuação
 * @returns {boolean}
 */
export function cpfValido(valor) {
  const cpf = apenasDigitos(valor);
  if (cpf.length !== 11) return false;

  // 111.111.111-11 passa na conta por coincidência. Recusa na mão.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  /** @param {number} ate */
  const digito = (ate) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(cpf[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

/**
 * Formata para exibição: 52998224725 → 529.982.247-25
 * Só para tela. O que vai para o banco é sempre `apenasDigitos`.
 *
 * @param {string|null|undefined} valor
 * @returns {string}
 */
export function formatarCpf(valor) {
  const c = apenasDigitos(valor);
  if (c.length !== 11) return String(valor ?? '');
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}
