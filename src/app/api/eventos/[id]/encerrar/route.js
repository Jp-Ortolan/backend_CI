/**
 * APRESENTAÇÃO — /api/eventos/:id/encerrar
 *
 * Mesma regra de /api/reunioes/:id/encerrar: evento e reunião compartilham
 * presença, convite e credenciamento (migration 010).
 */
export { POST } from '../../../reunioes/[id]/encerrar/route.js';

export const dynamic = 'force-dynamic';
