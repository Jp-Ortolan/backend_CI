# Perfis de acesso — o que cada um enxerga

RF03, RNF15 · revisto em outubro/2026 para os perfis do Fórum (migrations 007 e 008)

A regra vive em **dois lugares e precisa ser mudada nos dois**:

| Onde | Papel |
|---|---|
| `src/dominio/permissoes.js` | Decide o que a API aceita (403 antes de tocar o banco), o menu e a matriz que vai para o front |
| `banco/migrations/008_perfis_e_acesso.sql` (+ 001, 002, 009, 010) | Decide o que o banco aceita, linha a linha (RLS) e coluna a coluna (guardas) |

A interface esconder um botão não é controle de acesso — é conforto. Quem protege
o dado é o banco. Por isso as camadas dizem a mesma coisa, e há testes que falham
se divergirem (`testes/banco/10-perfis-forum.sql`).

---

## Os quatro perfis

| Perfil | `papel` | Quem é | Resumo |
|---|---|---|---|
| **Administrador geral** | `admin` | Coordenação do Centro de Inovação | Tudo, inclusive contas, configurações e exclusão definitiva |
| **Diretoria** | `diretoria` | Diretoria do Fórum | Cadastra, aprova, cria reuniões e eventos, corrige presença. **Não exclui e não mexe em contas** |
| **Representante da instituição** | `representante` | A conta **de uma instituição** | Consulta o Fórum, cuida dos dados da própria instituição e **pede** o que é sensível |
| **Público** | — (sem login) | Qualquer pessoa | Painel público (`/api/publico`) e check-in por QR Code |

Mudança de nomes (migration 007, sem perda de dado): `gestor` → `diretoria`,
`leitura` → `representante`. As contas "leitura" antigas viraram representante
**sem instituição** — entram, mas recebem um aviso e não veem a área da
instituição até o admin ligá-las a uma (`PATCH /api/usuarios/:id`).

---

## Matriz (a tabela da revisão)

Legenda: ● permitido · ◐ só da própria instituição · ✎ pede por solicitação · ○ negado

| Funcionalidade | Admin | Diretoria | Representante | Público |
|---|:---:|:---:|:---:|:---:|
| Visualizar dashboard geral | ● | ● | ● (geral + a dele) | ● dados públicos |
| Gerenciar contas e permissões | ● | ○ | ○ | ○ |
| Cadastrar/editar instituições | ● | ● | ◐ contato, endereço, redes, logo | ○ |
| Alterar nome, CNPJ, classificação | ● | ● | ✎ | ○ |
| Aprovar entrada de instituição | ● | ● | ○ (envia para análise) | ○ |
| Alterar representantes (titular/suplente) | ● | ● | ✎ | ○ |
| Enviar ofício e logo | ● | ● | ◐ | ○ |
| Criar / editar reuniões | ● | ● | ○ | ○ |
| Criar / editar eventos | ● | ● | ○ | ○ |
| Abrir/fechar credenciamento, gerar QR | ● | ● | ○ | ○ |
| Registrar presença via QR Code | ● | ● | ◐ a própria | convidado, quando permitido |
| Corrigir presença manualmente | ● | ● | ✎ | ○ |
| Visualizar listas nominais | ● | ● | ◐ | ○ |
| Gerar relatórios e exportações | ● | ● | ◐ relatório próprio | ○ |
| Consultar instituições e logos | ● | ● | ● | ● as que autorizaram |
| Aprovar/recusar solicitações | ● | ● | ○ (cancela a própria) | ○ |
| Excluir registros definitivamente | ● | ○ | ○ | ○ |

### Por que a Diretoria não exclui

"Preferencialmente não." Excluir uma instituição ou um vínculo leva junto o
histórico de participação. Diretoria **inativa, desliga, encerra e cancela** —
o histórico fica. Exclusão é exceção e passa pelo admin (e o banco ainda recusa
quando há histórico: migrations 002, 003 e 004).

### O que "da própria instituição" quer dizer no banco

O representante tem `usuario.instituicao_id`. As políticas da 008 recortam por ela:

| Tabela | Representante enxerga |
|---|---|
| `instituicao` | todas (consultar é ● para todos); observação interna sai `null` na API |
| `pessoa`, `vinculo` | quem tem vínculo com a instituição dele, e ele mesmo |
| `presenca`, `reuniao_convite` | da instituição dele, e as dele |
| `reuniao` | todas, menos as em `rascunho` |
| `documento` | os da instituição dele, os de `membros` e os `publico` |
| `solicitacao` | as da instituição dele |
| `log_auditoria` | o histórico da instituição dele |

E as **guardas** (triggers da 008) cuidam das colunas que a política não vê:
- instituição ativa: o representante só muda `email`, `telefone`, `site`,
  endereço, `descricao`, `redes_sociais`, `contatos_comunicacao`, logo e as
  autorizações. Em `rascunho` / `aguardando_documentos` / `ajustes_solicitados`
  ele preenche tudo, menos datas de entrada/saída e observação interna;
- situação: só `→ em_analise` (enviar para análise). Aprovar é da gestão;
- pessoa: o representante muda os próprios contatos e a autorização de
  comunicação, não nome nem CPF;
- usuário: ninguém além do admin muda papel, instituição, e-mail ou `ativo`.

---

## Menu lateral por perfil

Escrito **por perfil** em `MENU` (antes era derivado de "pode ver", e como todos
podiam ver tudo, os três perfis tinham o mesmo menu — era o problema relatado).

| Item | href | Admin | Diretoria | Representante |
|---|---|:---:|:---:|:---:|
| Dashboard | `/dashboard` | ● | ● | ● |
| Minha instituição | `/minha-instituicao` | ○ | ○ | ● |
| Instituições | `/instituicoes` | ● | ● | ● |
| Representantes | `/representantes` | ● | ● | ○ |
| Reuniões | `/reunioes` | ● | ● | ● |
| Eventos | `/eventos` | ● | ● | ● |
| Presenças | `/presencas` | ● | ● | ● |
| Solicitações | `/solicitacoes` | ● | ● | ● |
| Documentos | `/documentos` | ● | ● | ○ |
| Relatórios | `/relatorios` | ● | ● | ○ |
| Usuários | `/usuarios` | ● | ○ | ○ |
| Configurações | `/configuracoes` | ● | ○ | ○ |

`POST /api/sessao` e `GET /api/sessao` devolvem `menu`, `permissoes` (a matriz
inteira do perfil), `escopo` (`tudo` | `instituicao`), `instituicao` e `avisos`.

---

## Como usar no código

```js
// Caso de uso
import { exigir, exigirInstituicaoPropria } from '@/aplicacao/guarda.js';
const u = exigir(usuario, 'instituicao', 'editar');   // 401/403 pela matriz
exigirInstituicaoPropria(u, instituicaoId);             // representante: só a dele
```

```jsx
// Front: mostrar ou esconder um botão a partir da resposta de /api/sessao
{usuario.permissoes.reuniao.includes('criar') && <BotaoNovaReuniao />}
```

Esconder o botão **não substitui** o `exigir()`. Quem chama a API direto ignora a
interface inteira — e, se a aplicação esquecer, o RLS e as guardas recusam.

---

## Contas

Não há autocadastro. O primeiro admin nasce pelo script:

```bash
node scripts/criar-usuario.mjs "Ana Admin" ana@centroinovacao.br admin
```

Daí em diante o admin cria as contas pela API (`POST /api/usuarios`). A conta
nasce **sem senha** e a pessoa recebe por e-mail o link para definir a dela
(vale 72 h; `POST /api/usuarios/:id/convite` reenvia). Mudar perfil, instituição
ou desativar derruba as sessões abertas daquela conta.

---

## Testes que protegem isto

| Teste | Onde | O que garante |
|---|---|---|
| 12 testes da matriz | `testes/dominio/permissoes.test.js` | Diretoria não exclui, representante não aprova, menus diferentes por perfil |
| 30 testes de acesso no banco | `testes/banco/10-perfis-forum.sql` | Conecta como `app_web` e confere RLS, guardas, solicitação, check-in e painel público |
| Ponta a ponta | `testes/integracao/forum.test.js` | Fluxos completos com a aplicação: solicitação aprovada, cadastro, credenciamento |
