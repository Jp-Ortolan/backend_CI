import { NextRequest, NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/servidor';

export async function POST(req: NextRequest) {
  const supabase = criarClienteServidor();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', req.nextUrl.origin), { status: 303 });
}
