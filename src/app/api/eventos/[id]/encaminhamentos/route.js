/**
 * APRESENTAÇÃO — /api/eventos/:id/encaminhamentos
 *
 * Mesma regra de /api/reunioes/:id/encaminhamentos: evento e reunião compartilham
 * presença, convite e credenciamento (migration 010).
 */
export { GET, POST } from '../../../reunioes/[id]/encaminhamentos/route.js';

export const dynamic = 'force-dynamic';
