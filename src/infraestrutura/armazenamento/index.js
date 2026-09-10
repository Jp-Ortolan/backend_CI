/**
 * Escolhe o adaptador de armazenamento.
 *
 * Hoje existe um só. O ponto de ter este arquivo é que o resto do sistema
 * importa daqui e nunca do adaptador — quando entrar S3/R2, muda-se este
 * arquivo e mais nada.
 *
 * O contrato que um adaptador novo precisa cumprir está em porta.js.
 */
import * as postgres from './postgres.js';

const ADAPTADORES = { postgres };

const escolhido = process.env.ARMAZENAMENTO ?? 'postgres';
const adaptador = ADAPTADORES[escolhido];

if (!adaptador) {
  // Falha na importação, não na primeira vez que alguém enviar um arquivo. Um
  // erro de configuração tem que aparecer ao subir a aplicação, e não três dias
  // depois na mão de um usuário.
  throw new Error(
    `ARMAZENAMENTO="${escolhido}" não existe. Disponíveis: ${Object.keys(ADAPTADORES).join(', ')}.`,
  );
}

export const { salvar, ler, remover, nome } = adaptador;
