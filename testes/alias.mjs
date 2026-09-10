/**
 * Resolve o alias "@/..." fora do Next.
 *
 * O jsconfig.json mapeia "@/*" para "./src/*", e o Next entende isso ao montar
 * o bundle. O `node --test` não: ele roda os arquivos direto, e um import de
 * "@/dominio/erros.js" quebraria com ERR_MODULE_NOT_FOUND.
 *
 * Estes ganchos ensinam o mesmo mapa ao carregador de módulos do Node, para os
 * testes poderem importar os casos de uso exatamente como a aplicação importa.
 * Sem isto, ou os testes não alcançam a camada de aplicação, ou o código de
 * produção teria que usar caminho relativo só para ser testável — trocar a
 * clareza do código pela conveniência do teste é o negócio errado.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ_SRC = pathToFileURL(path.join(process.cwd(), 'src') + path.sep).href;

/**
 * @param {string} especificador
 * @param {object} contexto
 * @param {Function} proximo
 */
export function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith('@/')) {
    return proximo(RAIZ_SRC + especificador.slice(2), contexto);
  }
  return proximo(especificador, contexto);
}
