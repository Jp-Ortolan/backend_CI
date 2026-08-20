/**
 * Moldura das telas públicas de acesso. A estilização definitiva vem do
 * design system da trilha de UX/UI — aqui fica só o mínimo para o fluxo
 * funcionar e ser testável.
 *
 * @param {{ children: React.ReactNode }} props
 */
export default function LayoutAuth({ children }) {
  return (
    <div className="auth-palco">
      <main className="auth-cartao">
        <p className="auth-marca">Centro de Inovação</p>
        <h1 className="auth-titulo">Sistema de Gestão do Ecossistema de Inovação</h1>
        {children}
      </main>
    </div>
  );
}
