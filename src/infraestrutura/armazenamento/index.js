/**
 * Escolhe o adaptador de armazenamento (contrato em porta.js).
 * O resto do sistema importa daqui, nunca do adaptador.
 */
import * as postgres from './postgres.js';

const ADAPTADORES = { postgres };

const escolhido = process.env.ARMAZENAMENTO ?? 'postgres';
const adaptador = ADAPTADORES[escolhido];

if (!adaptador) {
// Falha ao subir a aplicação, e não na primeira vez que alguém enviar arquivo.
  throw new Error(
    `ARMAZENAMENTO="${escolhido}" não existe. Disponíveis: ${Object.keys(ADAPTADORES).join(', ')}.`,
  );
}

export const { salvar, ler, remover, nome } = adaptador;
