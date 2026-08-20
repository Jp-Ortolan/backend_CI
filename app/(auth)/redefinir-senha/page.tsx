import { FormRedefinir } from '../formularios';

export const dynamic = 'force-dynamic';

export default function PaginaRedefinir({
  searchParams,
}: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? '';

  if (!token) {
    return (
      <>
        <h2 className="auth-h2">Link inválido</h2>
        <p className="auth-sub">
          Este endereço não traz um código de recuperação. Peça a recuperação de senha
          novamente para receber um link novo.
        </p>
        <p><a className="link" href="/recuperar-senha">Pedir novo link</a></p>
      </>
    );
  }

  return (
    <>
      <h2 className="auth-h2">Definir nova senha</h2>
      <p className="auth-sub">Escolha uma senha de pelo menos 8 caracteres.</p>
      <FormRedefinir token={token} />
    </>
  );
}
