/**
 * Liga os ganchos de resolução do alias antes de qualquer teste carregar.
 *
 * Uso:  node --import ./testes/registrar-alias.mjs --test "testes/**\/*.test.js"
 */
import { register } from 'node:module';

register('./alias.mjs', import.meta.url);
