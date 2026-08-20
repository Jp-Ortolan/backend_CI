import { redirect } from 'next/navigation';
import { usuarioAtual } from '@/infraestrutura/seguranca/sessao.js';
import { FormLogin } from '../formularios.jsx';

export const dynamic = 'force-dynamic';

/** @type {Record<string, string>} */
const MENSAGENS = {
  sessao_expirada: 'Sua sessão expirou. Entre novamente.',
  sem_sessao: 'Entre para continuar.',
};

/**
 * @param {{ searchParams: { redirecionar?: string, erro?: string } }} props
 */
export default async function PaginaLogin({ searchParams }) {
  if (await usuarioAtual()) redirect('/dashboard');

  const aviso = searchParams.erro ? MENSAGENS[searchParams.erro] : undefined;

  return (
    <>
      <h2 className="auth-h2">Entrar</h2>
      <p className="auth-sub">Use o e-mail cadastrado pela coordenação.</p>
      {aviso && <p className="msg erro" role="alert">{aviso}</p>}
      <FormLogin redirecionar={searchParams.redirecionar} />
      <p className="auth-rodape">
        O acesso é criado pela coordenação do Centro de Inovação.<br />
        Participante de reunião não precisa de conta.
      </p>
    </>
  );
}
