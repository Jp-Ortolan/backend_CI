'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { entrar, pedirRecuperacao, redefinirSenha, type EstadoForm } from './acoes';

const INICIAL: EstadoForm = {};

function Botao({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending} aria-busy={pending}>
      {pending ? 'Aguarde...' : children}
    </button>
  );
}

function Mensagem({ estado }: { estado: EstadoForm }) {
  if (estado.erro) return <p className="msg erro" role="alert">{estado.erro}</p>;
  if (estado.sucesso) return <p className="msg ok" role="status">{estado.sucesso}</p>;
  return null;
}

export function FormLogin({ redirecionar }: { redirecionar?: string }) {
  const [estado, acao] = useFormState(entrar, INICIAL);
  return (
    <form action={acao} className="form">
      <input type="hidden" name="redirecionar" value={redirecionar ?? ''} />
      <label className="campo">
        <span>E-mail</span>
        <input name="email" type="email" autoComplete="email" required
               placeholder="seu.email@centroinovacao.br" />
      </label>
      <label className="campo">
        <span>Senha</span>
        <input name="senha" type="password" autoComplete="current-password" required />
      </label>
      <Mensagem estado={estado} />
      <Botao>Entrar</Botao>
      <a className="link" href="/recuperar-senha">Esqueci minha senha</a>
    </form>
  );
}

export function FormRecuperar() {
  const [estado, acao] = useFormState(pedirRecuperacao, INICIAL);
  return (
    <form action={acao} className="form">
      <label className="campo">
        <span>E-mail</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <Mensagem estado={estado} />
      <Botao>Enviar instruções</Botao>
      <a className="link" href="/login">Voltar para o login</a>
    </form>
  );
}

export function FormRedefinir({ token }: { token: string }) {
  const [estado, acao] = useFormState(redefinirSenha, INICIAL);
  return (
    <form action={acao} className="form">
      <input type="hidden" name="token" value={token} />
      <label className="campo">
        <span>Nova senha</span>
        <input name="senha" type="password" autoComplete="new-password" required minLength={8} />
      </label>
      <label className="campo">
        <span>Repita a nova senha</span>
        <input name="confirmacao" type="password" autoComplete="new-password" required minLength={8} />
      </label>
      <Mensagem estado={estado} />
      <Botao>Salvar nova senha</Botao>
      {estado.sucesso && <a className="link" href="/login">Ir para o login</a>}
    </form>
  );
}
