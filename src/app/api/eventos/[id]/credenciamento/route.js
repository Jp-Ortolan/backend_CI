/**
 * APRESENTAÇÃO — /api/eventos/:id/credenciamento
 *
 * Mesma regra de /api/reunioes/:id/credenciamento: evento e reunião compartilham
 * presença, convite e credenciamento (migration 010).
 */
export { POST } from '../../../reunioes/[id]/credenciamento/route.js';

export const dynamic = 'force-dynamic';
