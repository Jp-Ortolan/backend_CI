/**
 * APRESENTAÇÃO — /api/eventos/:id/status
 *
 * Mesma regra de /api/reunioes/:id/status: evento e reunião compartilham
 * presença, convite e credenciamento (migration 010).
 */
export { POST } from '../../../reunioes/[id]/status/route.js';

export const dynamic = 'force-dynamic';
