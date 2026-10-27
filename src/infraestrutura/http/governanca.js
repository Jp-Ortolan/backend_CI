/**
 * Respostas do contrato /api/governanca (docs/prompt-backend.md do front).
 *
 *   - toda resposta de sucesso leva `versao: 1` (versão do CONTRATO);
 *   - mutação leva `confirmado: true` — só depois de gravar. O front não
 *     anuncia sucesso sem isso;
 *   - links (arquivo, QR, relatório, logo) são ABSOLUTOS, http(s).
 *
 * Erros continuam no envelope `{ erro: { codigo, mensagem, campos } }` de
 * resposta.js — é o mesmo que o contrato pede.
 */
import { NextResponse } from 'next/server';

/**
 * @param {Record<string, unknown>} dados
 * @param {number} [status]
 */
export function okV1(dados, status = 200) {
  return NextResponse.json({ versao: 1, ...dados }, { status });
}

/**
 * Mutação gravada.
 *
 * @param {Record<string, unknown>} [dados]
 * @param {number} [status]
 */
export function confirmadoV1(dados = {}, status = 200) {
  return NextResponse.json({ versao: 1, confirmado: true, ...dados }, { status });
}

/**
 * Endereço público desta API, para montar link absoluto.
 * URL_API manda; sem ela, o que o proxy do Railway informou na requisição.
 *
 * @param {Request} req
 * @returns {string} sem barra no fim
 */
export function baseDaApi(req) {
  if (process.env.URL_API) return process.env.URL_API.replace(/\/+$/, '');
  const h = req.headers;
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000').split(',')[0].trim();
  const proto = (h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'))
    .split(',')[0].trim();
  return `${proto}://${host}`;
}
