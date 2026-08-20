import { NextResponse } from 'next/server';
import { encerrarSessao } from '@/lib/auth/sessao.js';

/**
 * @param {import('next/server').NextRequest} req
 */
export async function POST(req) {
  await encerrarSessao();
  return NextResponse.redirect(new URL('/login', req.nextUrl.origin), { status: 303 });
}
