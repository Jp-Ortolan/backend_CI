import { redirect } from 'next/navigation';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';

export default async function Raiz() {
  redirect((await usuarioAtual()) ? '/dashboard' : '/login');
}
