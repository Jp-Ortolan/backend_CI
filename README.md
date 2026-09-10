# Sistema de Gestão do Ecossistema de Inovação

Plataforma web para centralizar a base do ecossistema do Centro de Inovação —
instituições, representantes, vínculos, reuniões e presenças — e automatizar o
registro de participação por QR Code.


---

## Começar aqui

Precisa de **Node 20+** e um **PostgreSQL 15+** (na máquina ou em Docker).

```bash
git clone <url-do-repositorio>
cd ecossistema-inovacao
npm install

# banco local em Docker (pule se já tiver Postgres instalado)
docker run --name eco-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16

# troque "postgres:postgres" pelo usuário:senha da SUA instalação
export DATABASE_URL_ADMIN="postgresql://postgres:postgres@localhost:5432/postgres"
./scripts/resetar.sh          # cria tudo do zero e carrega dados de exemplo

# senha do usuário que a aplicação usa (não é o dono do banco — ver adiante)
psql "$DATABASE_URL_ADMIN" -c "alter role app_web with login password 'app';"

cp .env.example .env.local    # ajuste DATABASE_URL para o app_web
npm run dev                   # http://localhost:3000
```

O seed já traz três acessos prontos, todos com a senha **`senha123456`**:

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a aplicação em desenvolvimento |
| `npm run db:migrar` | Aplica as migrations que ainda não rodaram |
| `npm run db:resetar` | Apaga e recria o banco local com seed (recusa rodar fora de localhost) |
| `npm run db:testar` | 36 testes de regra, acesso e check-in direto no banco |
| `npm run test:dominio` | 11 testes da matriz de permissões |
| `npm run test:integracao` | 8 testes de autenticação contra um banco real |
| `npm run lint` | Verificação de estilo e de erros comuns (ESLint) |

---

## A linguagem do projeto

**O projeto é JavaScript.** Não há TypeScript, `tsconfig.json` nem etapa de
compilação de tipos — `npm install` e pronto.

O que existe no lugar são comentários JSDoc nos pontos que valem a pena:

```js
/**
 * @param {string} usuarioId
 * @param {(tx: Transacao) => Promise<T>} acao
 */
export async function comUsuario(usuarioId, acao) { ... }
```

Isso é comentário — o Node ignora. Mas o VS Code lê e passa a completar nomes e
avisar quando algo está escrito errado (um papel `"gerente"` onde só existe
`admin`, `gestor` ou `leitura`, por exemplo). O `jsconfig.json` na raiz é o que
liga essa verificação; apagá-lo não quebra nada, só tira o aviso.

Os tipos das tabelas ficam em `lib/tipos-banco.js`, também como JSDoc.

## Os dois usuários do banco

No PostgreSQL, o **dono** das tabelas ignora o RLS. Se a aplicação conectasse
como dono, todo o controle de acesso viraria enfeite.

| Usuário | Para quê | Variável |
|---|---|---|
| `postgres` (dono) | Migrations, seeds, criar usuário | `DATABASE_URL_ADMIN` |
| `app_web` (não é dono) | A aplicação | `DATABASE_URL` |

A migration 007 cria o `app_web` sem senha; quem define é o DevOps, para a senha
não ficar no repositório. Detalhes em [docs/03-ambientes.md](docs/03-ambientes.md).

---

## O que tem aqui

| Pasta | Conteúdo | Trilha |
|---|---|---|
| `banco/migrations/` | A migration única que cria o banco inteiro | Back-end |
| `banco/seed.sql` | Dados de exemplo para desenvolver | Back-end |
| `src/app/` | ① Apresentação: telas e rotas HTTP | Back-end → Front-end |
| `src/aplicacao/` | ② Casos de uso: uma ação do sistema por arquivo | Back-end |
| `src/dominio/` | ③ Regras de negócio e matriz de permissões | Back-end |
| `src/infraestrutura/` | ④ Banco, senha, sessão, e-mail, HTTP | Back-end |
| `testes/` | Os 55 testes (banco, domínio, integração) | Back-end + QA |
| `scripts/` | Migrar, resetar, testar, criar usuário | DevOps |
| `docs/` | Arquitetura, Git, ambientes, API, permissões, mapa | Todos |
| `qa/` | Plano de testes e os 45 casos | QA |

O projeto segue **arquitetura em camadas**: apresentação → aplicação → domínio,
com a infraestrutura de lado. `src/dominio/` não importa nada de ninguém.
O detalhe arquivo por arquivo está em

---

## Documentos

| Documento | Para quem |
|---|---|
| [Mapa do projeto](docs/06-mapa-do-projeto.md) | **Comece por aqui** — padrão de arquitetura e o que faz cada arquivo |
| [Arquitetura](docs/01-arquitetura.md) | Todos — leitura obrigatória antes do primeiro PR |
| [Git e branches](docs/02-git-e-branches.md) | Todos |
| [Ambientes e Railway](docs/03-ambientes.md) | DevOps |
| [Contrato de API](docs/04-contrato-de-api.md) | Back-end e Front-end |
| [Perfis de acesso](docs/05-permissoes.md) | Todos |
| [Plano de testes](qa/01-plano-de-testes.md) | QA |
| [Casos de teste](qa/02-casos-de-teste.md) | QA |

---

## Stack

Next.js 14 (App Router) · PostgreSQL no Railway · `pg` · GitHub Actions

