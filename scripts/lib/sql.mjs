/**
 * Ler arquivo .sql e mandar para o servidor, como o psql faria.
 * Usado pelo migrar.mjs e pelo testar-banco.mjs.
 */

/**
 * Tira as meta-instruções do psql (`\set`, `\echo`...).
 *
 * Elas são interpretadas pelo cliente psql, não pelo servidor — mandar `\set`
 * para o PostgreSQL dá erro de sintaxe. `ON_ERROR_STOP` não faz falta aqui: o
 * driver já rejeita a promessa no primeiro erro.
 */
export const semMetaComandos = (sql) =>
  sql.split('\n').filter((l) => !/^\s*\\/.test(l)).join('\n');

/**
 * Divide o arquivo em instruções, uma por `;` de primeiro nível.
 *
 * POR QUE ISSO É NECESSÁRIO
 * Mandar o arquivo inteiro numa chamada só faz o PostgreSQL tratar tudo como
 * UMA transação implícita. Aí um `set local role app_web` dentro de um bloco
 * vaza para todos os blocos seguintes, e o teste seguinte roda com o papel
 * errado — falhando por motivo que não é o dele. O psql não tem esse problema
 * porque manda uma instrução por vez, cada uma com seu autocommit.
 *
 * O divisor precisa entender três coisas para não cortar no lugar errado:
 * texto entre aspas simples, comentários, e o dollar-quoting ($$ ... $$) que
 * envolve o corpo de toda função e de todo bloco DO — que é justamente onde
 * mais aparece ponto e vírgula.
 *
 * @param {string} sql
 * @returns {string[]}
 */
export function dividirInstrucoes(sql) {
  /** @type {string[]} */
  const instrucoes = [];
  let atual = '';
  let i = 0;

  while (i < sql.length) {
    const resto = sql.slice(i);

    // Comentário de linha: vai inteiro para a instrução atual, sem interpretar.
    if (resto.startsWith('--')) {
      const fim = sql.indexOf('\n', i);
      const ate = fim === -1 ? sql.length : fim + 1;
      atual += sql.slice(i, ate);
      i = ate;
      continue;
    }

    // Comentário de bloco.
    if (resto.startsWith('/*')) {
      const fim = sql.indexOf('*/', i + 2);
      const ate = fim === -1 ? sql.length : fim + 2;
      atual += sql.slice(i, ate);
      i = ate;
      continue;
    }

    // Texto entre aspas simples. Duas aspas seguidas são um escape, não o fim.
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j += 1;
      }
      atual += sql.slice(i, j);
      i = j;
      continue;
    }

    // Dollar-quoting: $$ ... $$ ou $tag$ ... $tag$.
    const abre = resto.match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (abre) {
      const marca = abre[0];
      const fim = sql.indexOf(marca, i + marca.length);
      const ate = fim === -1 ? sql.length : fim + marca.length;
      atual += sql.slice(i, ate);
      i = ate;
      continue;
    }

    if (sql[i] === ';') {
      atual += ';';
      if (atual.trim()) instrucoes.push(atual);
      atual = '';
      i += 1;
      continue;
    }

    atual += sql[i];
    i += 1;
  }

  if (atual.trim()) instrucoes.push(atual);
  return instrucoes;
}

/**
 * Roda o arquivo instrução por instrução, como o psql faria.
 *
 * @param {import('pg').Client} c
 * @param {string} sql
 */
export async function executarArquivo(c, sql) {
  for (const instrucao of dividirInstrucoes(semMetaComandos(sql))) {
    await c.query(instrucao);
  }
}

