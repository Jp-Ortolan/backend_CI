import { NextRequest, NextResponse } from 'next/server';
import { encerrarSessao } from '@/lib/auth/sessao';

export async function POST(req: NextRequest) {
  await encerrarSessao();
  return NextResponse.redirect(new URL('/login', req.nextUrl.origin), { status: 303 });
}
