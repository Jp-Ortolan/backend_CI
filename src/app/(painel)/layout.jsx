import { exigirUsuario } from '@/lib/auth/sessao.js';
import { menuDoPapel, ROTULO_PAPEL } from '@/lib/dominio/permissoes.js';

/**
 * Moldura autenticada. Além do middleware, esta camada resolve o papel do
 * usuário e monta o menu com o que ele pode ver (RF03).
 *
 * @param {{ children: React.ReactNode }} props
 */
export default async function LayoutPainel({ children }) {
  const usuario = await exigirUsuario();
  const itens = menuDoPapel(usuario.papel);
  const iniciais = usuario.nome.split(' ').filter(Boolean).slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '').join('');

  return (
    <div className="painel">
      <aside className="painel-lateral">
        <div className="painel-marca">
          <strong>Ecossistema de Inovação</strong>
          <small>Centro de Inovação</small>
        </div>
        <nav>
          <ul>
            {itens.map(i => (
              <li key={i.href}><a href={i.href}>{i.rotulo}</a></li>
            ))}
          </ul>
        </nav>
        <div className="painel-perfil">
          <span className="avatar" aria-hidden="true">{iniciais}</span>
          <span>
            <strong>{usuario.nome}</strong>
            <small>{ROTULO_PAPEL[usuario.papel]}</small>
          </span>
          <form action="/sair" method="post">
            <button type="submit" className="link">Sair</button>
          </form>
        </div>
      </aside>
      <div className="painel-conteudo">{children}</div>
    </div>
  );
}
