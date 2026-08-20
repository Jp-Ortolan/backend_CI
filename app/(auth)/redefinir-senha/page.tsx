import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { FormRedefinir } from '../formularios';

export default async function PaginaRedefinir() {
  // Só chega aqui quem veio pelo link do e-mail — o callback já criou a sessão.
  const supabase = criarClienteServidor();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login?erro=link_expirado');

  return (
    <>
      <h2 className="auth-h2">Definir nova senha</h2>
      <p className="auth-sub">Escolha uma senha de pelo menos 8 caracteres.</p>
      <FormRedefinir />
    </>
  );
}
