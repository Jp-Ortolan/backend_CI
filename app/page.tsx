import { redirect } from 'next/navigation';
import { usuarioAtual } from '@/lib/auth/sessao';

export default async function Raiz() {
  redirect((await usuarioAtual()) ? '/dashboard' : '/login');
}
