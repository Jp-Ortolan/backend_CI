/**
 * APRESENTAÇÃO — /api/eventos/:id/participantes
 *
 * Mesma regra de /api/reunioes/:id/participantes: evento e reunião compartilham
 * presença, convite e credenciamento (migration 010).
 */
export { GET } from '../../../reunioes/[id]/participantes/route.js';

export const dynamic = 'force-dynamic';
