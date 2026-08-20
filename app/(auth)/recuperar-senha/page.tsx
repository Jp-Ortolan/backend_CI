import { FormRecuperar } from '../formularios';

export default function PaginaRecuperar() {
  return (
    <>
      <h2 className="auth-h2">Recuperar senha</h2>
      <p className="auth-sub">
        Informe seu e-mail. Se houver uma conta cadastrada, você receberá um link para
        definir uma nova senha.
      </p>
      <FormRecuperar />
    </>
  );
}
