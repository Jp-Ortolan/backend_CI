# Perfis de acesso — o que cada um enxerga

Semana 2 · trilha Back-end · RF03, RNF15

A regra vive em **dois lugares e precisa ser mudada nos dois**:

| Onde | Papel |
|---|---|
| `lib/dominio/permissoes.js` | Decide o que a interface mostra e o que a Server Action aceita |
| `db/migrations/007_seguranca_rls.sql` | Decide o que o banco aceita, independente da aplicação |

A interface esconder um botão não é controle de acesso — é conforto. Quem protege
o dado é o RLS. Por isso as duas camadas dizem a mesma coisa, e há um teste
automatizado (`tests/01-regras-de-negocio.sql`) que falha se elas divergirem.

---

## Os três perfis

| Perfil | Quem é | Resumo |
|---|---|---|
| **Administrador** | Coordenação do Centro de Inovação | Tudo, inclusive gerir usuários e excluir registros |
| **Gestor** | Equipe que opera o dia a dia | Cadastra, edita e encerra. **Não exclui e não gere usuários** |
| **Consulta** | Diretoria, parceiros, quem só acompanha | Só leitura |

O **participante de reunião não é usuário do sistema**. Ele não tem conta, não
faz login e só interage com a página pública de check-in.

---

## Matriz

Legenda: ● permitido · ○ negado

| Recurso | Ação | Admin | Gestor | Consulta |
|---|---|:---:|:---:|:---:|
| Instituições | ver | ● | ● | ● |
| | criar / editar | ● | ● | ○ |
| | encerrar (inativar) | ● | ● | ○ |
| | excluir | ● | ○ | ○ |
| Representantes e vínculos | ver | ● | ● | ● |
| | criar / editar / encerrar | ● | ● | ○ |
| | excluir | ● | ○ | ○ |
| Reuniões | ver | ● | ● | ● |
| | criar / editar / encerrar | ● | ● | ○ |
| | excluir | ● | ○ | ○ |
| Presenças | ver | ● | ● | ● |
| | registrar / corrigir | ● | ● | ○ |
| | excluir | ● | ○ | ○ |
| Documentos | ver / baixar | ● | ● | ● |
| | enviar | ● | ● | ○ |
| | excluir | ● | ○ | ○ |
| Indicadores | ver | ● | ● | ● |
| | exportar | ● | ● | ○ |
| Usuários | ver / criar / editar / desativar | ● | ○ | ○ |

### Por que gestor não exclui

Excluir uma instituição ou um vínculo não apaga só uma linha: leva junto o
histórico de participação amarrado a ela. O sistema inteiro existe para
preservar esse histórico. Encerrar é a operação do dia a dia — exclusão é
exceção, e exceção passa pela coordenação.

### Por que gestor não gere usuários

Quem cria acesso decide quem entra no sistema. Concentrar isso no administrador
mantém uma pessoa responsável pela lista de quem tem acesso a dado pessoal de
representantes — o que também simplifica a conversa de LGPD.

---

## Menu lateral por perfil

Montado por `menuDoPapel()`, a partir da mesma matriz.

| Item | Admin | Gestor | Consulta |
|---|:---:|:---:|:---:|
| Dashboard | ● | ● | ● |
| Instituições | ● | ● | ● |
| Representantes | ● | ● | ● |
| Reuniões | ● | ● | ● |
| Presenças | ● | ● | ● |
| Documentos | ● | ● | ● |
| Usuários | ● | ○ | ○ |

Consulta e gestor veem os mesmos itens; a diferença aparece dentro de cada tela,
nos botões de ação.

---

## Como usar no código

```ts
// Server Component ou Server Action
import { exigirPermissao } from '@/lib/auth/sessao';
const usuario = await exigirPermissao('instituicao', 'editar');
// sem permissão, redireciona para /sem-permissao antes de qualquer consulta
```

```tsx
// Mostrar ou esconder um botão
import { pode } from '@/lib/dominio/permissoes';
{pode(usuario.papel, 'instituicao', 'criar') && <BotaoNovaInstituicao />}
```

Esconder o botão **não substitui** o `exigirPermissao` na ação. Quem chama a
API direto ignora a interface inteira.

---

## Não existe autocadastro

O sistema não tem tela de "criar conta" de propósito: quem cria acesso é a
coordenação. O primeiro administrador nasce pelo script:

```bash
node scripts/criar-usuario.mjs "Ana Gestora" ana@centroinovacao.br admin
```

Daí em diante, novos acessos são criados pelo administrador dentro do sistema, e
o padrão é `leitura` — ninguém ganha permissão de escrita sozinho.

---

## Testes que protegem isto

| Teste | Onde | O que garante |
|---|---|---|
| 11 testes da matriz | `tests/permissoes.test.js` | Gestor não exclui, consulta não escreve, menu correto por perfil |
| 9 testes de acesso no banco | `tests/03-seguranca.sql` | Conecta como `app_web` e confere o que cada perfil consegue de fato fazer |
| Sessão e RLS ponta a ponta | `tests/integracao.test.js` | Hash confere, sessão vale, `papel_atual()` devolve o papel certo |

---

## Casos de teste do QA cobertos

CT04 (perfil de consulta não edita) e CT05 (RLS bloqueia escrita fora do perfil)
já podem ser executados assim que o ambiente de homologação estiver de pé.
