/**
 * Testes das regras de negócio em TypeScript.
 *
 *     npm run test:dominio
 *
 * Cobrem a lógica pura — a que não depende do banco e por isso não aparece
 * nos testes SQL. A mais importante é vinculoNaData: é ela que garante o
 * snapshot correto no check-in (RF31).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkinAberto, vinculoNaData, normalizarBusca } from '../lib/dominio/checkin';
import type { ReuniaoPublica } from '../lib/dominio/checkin';
import { ErroDeNegocio } from '../lib/dominio/erros';
import type { Vinculo } from '../lib/tipos-banco';

const reuniao = (over: Partial<ReuniaoPublica> = {}): ReuniaoPublica => ({
  id: 'r1',
  titulo: 'Reunião Ordinária',
  data: '2026-09-18',
  hora_inicio: '09:00',
  local: 'Auditório',
  status: 'agendada',
  checkin_abre_em: null,
  checkin_fecha_em: null,
  ...over,
});

const vinculo = (over: Partial<Vinculo> = {}): Vinculo => ({
  id: 'v1',
  pessoa_id: 'p1',
  instituicao_id: 'i1',
  cargo: 'Coordenador',
  status: 'ativo',
  data_inicio: '2024-01-01',
  data_fim: null,
  ...over,
});

// --------------------------------------------------------------- RNF13
test('check-in aberto dentro da janela', () => {
  const r = reuniao({
    checkin_abre_em: '2026-09-18T11:00:00Z',
    checkin_fecha_em: '2026-09-18T15:00:00Z',
  });
  assert.equal(checkinAberto(r, new Date('2026-09-18T12:00:00Z')), true);
});

test('check-in fechado antes da janela', () => {
  const r = reuniao({
    checkin_abre_em: '2026-09-18T11:00:00Z',
    checkin_fecha_em: '2026-09-18T15:00:00Z',
  });
  assert.equal(checkinAberto(r, new Date('2026-09-18T10:59:00Z')), false);
});

test('check-in fechado depois da janela', () => {
  const r = reuniao({
    checkin_abre_em: '2026-09-18T11:00:00Z',
    checkin_fecha_em: '2026-09-18T15:00:00Z',
  });
  assert.equal(checkinAberto(r, new Date('2026-09-18T15:01:00Z')), false);
});

test('sem janela definida, vale o dia da reunião', () => {
  const r = reuniao();
  assert.equal(checkinAberto(r, new Date('2026-09-18T13:00:00Z')), true);
  assert.equal(checkinAberto(r, new Date('2026-09-19T13:00:00Z')), false);
});

test('reunião cancelada nunca aceita check-in', () => {
  const r = reuniao({ status: 'cancelada' });
  assert.equal(checkinAberto(r, new Date('2026-09-18T13:00:00Z')), false);
});

// ---------------------------------------------------------------- RF31
test('escolhe o vínculo vigente na data da reunião, não o atual', () => {
  const antigo = vinculo({
    id: 'v-alfa', instituicao_id: 'alfa', status: 'encerrado',
    data_inicio: '2019-03-01', data_fim: '2025-05-31',
  });
  const atual = vinculo({
    id: 'v-beta', instituicao_id: 'beta', status: 'ativo', data_inicio: '2025-06-01',
  });

  // Reunião de março/2025: José ainda representava a Alfa.
  assert.equal(vinculoNaData([antigo, atual], '2025-03-10')?.id, 'v-alfa');
  // Reunião de agosto/2025: já representava a Beta.
  assert.equal(vinculoNaData([antigo, atual], '2025-08-10')?.id, 'v-beta');
});

test('sem vínculo vigente na data devolve nulo', () => {
  const v = vinculo({ data_inicio: '2026-01-01' });
  assert.equal(vinculoNaData([v], '2025-08-10'), null);
});

test('havendo mais de um vínculo vigente, prefere o ativo', () => {
  const encerrado = vinculo({ id: 'a', status: 'encerrado', data_fim: '2026-12-31' });
  const ativo = vinculo({ id: 'b', instituicao_id: 'i2', status: 'ativo' });
  assert.equal(vinculoNaData([encerrado, ativo], '2026-06-01')?.id, 'b');
});

test('lista vazia devolve nulo', () => {
  assert.equal(vinculoNaData([], '2026-06-01'), null);
});

// --------------------------------------------------------------- RNF14
test('busca exige ao menos 3 caracteres', () => {
  assert.throws(() => normalizarBusca('jo'), ErroDeNegocio);
  assert.throws(() => normalizarBusca('   '), ErroDeNegocio);
});

test('busca normaliza espaços', () => {
  assert.equal(normalizarBusca('  jose   da  silva '), 'jose da silva');
});
