/**
 * Exportação em CSV que o Excel abre direito.
 *
 * Três detalhes que fazem a diferença no Excel em português:
 *   - BOM UTF-8 no começo: sem ele, "Guarapuava — Instituição" vira lixo;
 *   - ponto e vírgula como separador: no Excel pt-BR a vírgula é decimal;
 *   - célula que começa com = + - @ ganha um apóstrofo: sem isso, um nome
 *     cadastrado como "=HYPERLINK(...)" vira fórmula na máquina de quem abre
 *     (injeção de CSV).
 */

const PERIGOSO = /^[=+\-@\t\r]/;

/** @param {unknown} v */
function celula(v) {
  if (v === null || v === undefined) return '';
  let t = v instanceof Date ? v.toISOString() : String(v);
  if (PERIGOSO.test(t)) t = `'${t}`;
  if (/[";\n\r]/.test(t)) t = `"${t.replace(/"/g, '""')}"`;
  return t;
}

/**
 * @param {{ chave: string, titulo: string }[]} colunas
 * @param {Record<string, unknown>[]} linhas
 * @returns {string}
 */
export function gerarCsv(colunas, linhas) {
  const cabecalho = colunas.map((c) => celula(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => celula(l[c.chave])).join(';'));
  return `﻿${[cabecalho, ...corpo].join('\r\n')}\r\n`;
}
