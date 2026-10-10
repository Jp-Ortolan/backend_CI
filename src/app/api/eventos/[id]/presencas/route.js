/**
 * APRESENTAÇÃO — /api/eventos/:id/presencas
 *
 * Mesma regra de /api/reunioes/:id/presencas: evento e reunião compartilham
 * presença, convite e credenciamento (migration 010).
 */
export { POST } from '../../../reunioes/[id]/presencas/route.js';

export const dynamic = 'force-dynamic';
