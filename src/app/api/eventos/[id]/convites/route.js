/**
 * APRESENTAÇÃO — /api/eventos/:id/convites
 *
 * Mesma regra de /api/reunioes/:id/convites: evento e reunião compartilham
 * presença, convite e credenciamento (migration 010).
 */
export { POST } from '../../../reunioes/[id]/convites/route.js';

export const dynamic = 'force-dynamic';
