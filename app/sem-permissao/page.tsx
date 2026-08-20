export default function SemPermissao() {
  return (
    <main className="conteudo">
      <h1>Você não tem acesso a esta área</h1>
      <p>
        Seu perfil não permite esta ação. Se precisar dela para o seu trabalho,
        fale com a coordenação do Centro de Inovação.
      </p>
      <p><a className="link" href="/dashboard">Voltar ao início</a></p>
    </main>
  );
}
