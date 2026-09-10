# Sistema de Gestão do Ecossistema de Inovação — Back-end

Plataforma web do Centro de Inovação de Guarapuava para centralizar a base do
ecossistema — instituições, representantes, vínculos, reuniões e presenças — e
automatizar o registro de participação por QR Code.

**Entrega da primeira versão: 30/09/2026.**

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Next.js 14 (App Router) |
| Linguagem | JavaScript + JSDoc (sem TypeScript) |
| Banco de dados | PostgreSQL 15+ |
| Acesso ao banco | `pg` (sem ORM) |
| Autenticação | Argon2id + sessão em cookie `httpOnly` |
| Autorização | Row Level Security no próprio PostgreSQL |
| Validação | Zod |
| Testes | `node:test` + SQL puro |
| CI | GitHub Actions |
| Contrato da API | [`docs/04-contrato-de-api.md`](docs/04-contrato-de-api.md) |
| Deploy previsto | Railway |

## Estado atual

| | |
|---|---|
| **Endpoints** | 24 rotas sob `/api` |
| **Migrations** | 5, aplicadas em ordem |
| **Testes** | **210** — 82 de banco, 32 de domínio, 96 de integração |
| **Casos de teste (QA)** | 62, em [`qa/02-casos-de-teste.csv`](qa/02-casos-de-teste.csv) |
| **Verificação de saúde** | `GET /api/saude` — responde `{"status":"ok"}` |
| **Aplicação no ar** | ainda não publicada — o passo está em [`docs/03-ambientes.md`](docs/03-ambientes.md) |

## Começar aqui

Precisa de **Node 20+** e de um **PostgreSQL 15+** (na máquina ou em Docker).

```bash
git clone https://github.com/Jp-Ortolan/backend_CI.git
cd backend_CI
npm install
```

Suba um Postgres local, se ainda não tiver um:

```bash
docker compose up -d          # sobe o Postgres na porta 5432
```

Crie o banco, aplique as migrations, carregue o seed e rode os testes — tudo
num comando só:

```bash
# Linux / macOS
export DATABASE_URL_ADMIN="postgresql://postgres:postgres@localhost:5432/postgres"
npm run db:testar
```

```powershell
# Windows (PowerShell) — uma linha por vez, o PowerShell não entende "&&"
$env:DATABASE_URL_ADMIN = "postgresql://postgres:SUA_SENHA@localhost:5432/postgres"
npm run db:testar
```

No fim, o próprio comando imprime as duas variáveis prontas para colar. Copie-as
para `.env.local` (`cp .env.example .env.local`) e suba a aplicação:

```bash
npm run dev                   # http://localhost:3000
```

O seed traz três acessos, todos com a senha **`senha123456`**:

| E-mail | Perfil |
|---|---|
| `ana@centroinovacao.br` | Administrador |
| `carla@centroinovacao.br` | Gestor |
| `bruno@centroinovacao.br` | Consulta |

Entre com cada um para ver o menu mudar — é a matriz de permissões funcionando.

## Estrutura de pastas

```
backend_CI/
├── src/
│   ├── app/                        # ① Apresentação — telas e rotas HTTP
│   │   ├── (acesso)/               #    login, recuperar e redefinir senha
│   │   ├── (painel)/               #    área autenticada (dashboard)
│   │   ├── api/                    #    24 rotas REST
│   │   └── middleware.js           #    exige sessão fora das rotas públicas
│   ├── aplicacao/                  # ② Casos de uso — uma ação por arquivo
│   │   ├── autenticacao/           #    entrar, recuperar senha
│   │   ├── instituicoes/           #    CRUD, busca, status, histórico
│   │   ├── representantes/         #    CRUD e vínculos
│   │   ├── reunioes/               #    CRUD, encerrar, status
│   │   ├── convites/               #    convidar, responder, participantes
│   │   ├── presencas/              #    marcação manual
│   │   ├── checkin/                #    fluxo público do QR Code
│   │   ├── documentos/             #    enviar, listar, baixar, remover
│   │   ├── indicadores/            #    dashboard
│   │   └── guarda.js               #    exigir() permissão + validar() entrada
│   ├── dominio/                    # ③ Regras — não importa nada de ninguém
│   │   ├── permissoes.js           #    matriz de perfis
│   │   ├── cnpj.js                 #    validação de dígito verificador
│   │   ├── arquivos.js             #    tipos permitidos e assinatura binária
│   │   ├── erros.js                #    erros de negócio
│   │   └── tipos.js                #    tipos das tabelas, em JSDoc
│   └── infraestrutura/             # ④ Ferramentas
│       ├── banco/                  #    pool, consulta com RLS, tradução de erros
│       ├── seguranca/              #    senha (Argon2id), sessão, tokens
│       ├── armazenamento/          #    porta + adaptador Postgres
│       ├── http/                   #    resposta padrão, limite por IP
│       ├── observabilidade/        #    log estruturado em JSON
│       └── email/                  #    envio (imprime no terminal sem provedor)
├── banco/
│   ├── migrations/                 # 5 migrations versionadas, aplicadas em ordem
│   │   ├── 001_estrutura_inicial.sql
│   │   ├── 002_alinhamento_telas.sql
│   │   ├── 003_protege_reuniao.sql
│   │   ├── 004_documentos.sql
│   │   └── 005_protecao_checkin.sql
│   └── seed.sql                    # dados de exemplo para desenvolver
├── testes/
│   ├── banco/                      # 82 testes de regra, acesso e indicador, em SQL
│   ├── dominio/                    # 32 testes de regra pura
│   └── integracao/                 # 96 testes contra um Postgres de verdade
├── scripts/                        # migrar, resetar, testar, backup, restaurar
├── docs/                           # arquitetura, ambientes, API, permissões
├── qa/                             # plano de testes, 62 casos, registro de execução
├── .github/workflows/              # CI: banco e aplicação
├── .env.example
├── docker-compose.yml
└── package.json
```

## Arquitetura

Arquitetura em camadas. A seta só aponta para dentro: `src/dominio/` não importa
nada de ninguém, e por isso pode ser testado sem banco, sem rede e sem mock.

```
Requisição HTTP
      │
      ▼
  middleware.js       ← exige sessão válida fora das rotas públicas
      │
      ▼
  src/app/api/        ← ① Apresentação: lê o corpo, devolve status e JSON
      │
      ▼
  src/aplicacao/      ← ② Caso de uso: exigir() permissão, validar() entrada,
      │                    orquestrar a transação
      ▼
  src/dominio/        ← ③ Regra de negócio pura
      │
      ▼
  src/infraestrutura/ ← ④ Banco, senha, sessão, log, armazenamento
      │
      ▼
   PostgreSQL         ← RLS: a última palavra sobre quem enxerga o quê
```

O detalhe arquivo por arquivo está em
[`docs/06-mapa-do-projeto.md`](docs/06-mapa-do-projeto.md).

## Módulos

| Módulo | Tabelas principais |
|---|---|
| Autenticação | `usuario`, `sessao`, `token_recuperacao` |
| Instituições | `instituicao`, `area_atuacao` |
| Representantes e vínculos | `representante`, `vinculo` |
| Reuniões | `reuniao`, `reuniao_convite` |
| Presenças e check-in | `presenca`, `checkin_tentativa` |
| Documentos | `documento`, `documento_conteudo` |
| Indicadores | views `vw_*` |
| Auditoria e notificações | `log_auditoria`, `notificacao` |

## Perfis de acesso

| Perfil | Permissões |
|---|---|
| `admin` | Acesso total, inclusive exclusão e auditoria |
| `gestor` | Cadastra e edita instituições, reuniões e documentos |
| `leitura` | Só consulta — não cria, não edita, não exclui |
| *(público)* | Apenas o check-in por QR Code, com limite por IP |

A matriz completa está em [`docs/05-permissoes.md`](docs/05-permissoes.md), e é a
mesma em dois lugares: em `src/dominio/permissoes.js`, para a resposta ser 403
antes de tocar o banco, e nas políticas de RLS, para valer mesmo que alguém
esqueça o `exigir()`.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a aplicação em desenvolvimento |
| `npm run build` | Compila para produção |
| `npm run db:testar` | Recria o banco, aplica migrations + seed e roda os 82 testes SQL |
| `npm run db:migrar` | Aplica só as migrations que ainda não rodaram *(bash)* |
| `npm run db:resetar` | Apaga e recria o banco local *(bash; recusa fora de localhost)* |
| `npm run test:dominio` | 32 testes de regra pura — não precisam de banco |
| `npm run test:integracao` | 96 testes contra um Postgres de verdade |
| `npm test` | Domínio + integração |
| `npm run lint` | ESLint |

`db:testar` é o único que roda igual no Windows e no Linux: é Node puro, não
precisa de `bash` nem de `psql` no PATH.

## Os dois usuários do banco

No PostgreSQL, o **dono** das tabelas ignora o RLS. Se a aplicação conectasse
como dono, todo o controle de acesso viraria enfeite.

| Usuário | Para quê | Variável |
|---|---|---|
| `postgres` (dono) | Migrations, seeds, backup | `DATABASE_URL_ADMIN` |
| `app_web` (não é dono) | A aplicação | `DATABASE_URL` |

O `app_web` nasce sem senha e sem `LOGIN`, de propósito: quem define é o DevOps,
com um comando único, para a senha não ficar no repositório. Em banco local
descartável o `npm run db:testar` já faz isso sozinho. Detalhes em
[`docs/03-ambientes.md`](docs/03-ambientes.md).

Há um teste que existe só para provar que a conexão da aplicação não virou a do
dono por descuido: *"sem usuário declarado, a aplicação não enxerga instituição"*.
Se ele passar a falhar, todos os testes de permissão do projeto estão passando
sem testar nada.

## As quatro regras do modelo

Valem para qualquer código que toque o banco:

1. **Representante é vínculo, não pessoa.** A pessoa existe sozinha; o que a liga
   a uma instituição é a tabela `vinculo`, com período. Encerrar vínculo nunca
   apaga linha.
2. **Presença é snapshot.** No check-in grava-se `vinculo_id`, `instituicao_id` e
   `cargo_no_momento`. Nunca deduza a instituição de uma presença antiga pelo
   vínculo atual.
3. **Indicador não se armazena.** Percentual e totais saem das views `vw_*`.
4. **Convidado não tem vínculo.** O banco recusa — a aplicação não deve tentar.

A regra 2 é a menos óbvia e a mais cara de corrigir depois: sem ela, cada troca
de instituição reescreve o histórico das reuniões passadas.

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

Os tipos das tabelas ficam em [`src/dominio/tipos.js`](src/dominio/tipos.js),
também como JSDoc.

## Mexer no banco

Crie o próximo arquivo numerado em `banco/migrations/` — hoje a última é a
`005_protecao_checkin.sql`, então a próxima é a `006_*.sql` — e rode:

```bash
npm run db:testar        # recria do zero e roda os 82 testes SQL
```

**Nunca edite uma migration já aplicada em outro ambiente.** O script guarda numa
tabela quais arquivos já rodaram; editar um deles deixa o banco de cada pessoa em
um estado diferente, e a diferença só aparece em produção.

## Documentos

| Documento | Para quem |
|---|---|
| [Mapa do projeto](docs/06-mapa-do-projeto.md) | **Comece por aqui** — o que faz cada arquivo |
| [Arquitetura](docs/01-arquitetura.md) | Todos — leitura obrigatória antes do primeiro PR |
| [Git e branches](docs/02-git-e-branches.md) | Todos |
| [Ambientes e Railway](docs/03-ambientes.md) | DevOps |
| [Contrato de API](docs/04-contrato-de-api.md) | Back-end e Front-end |
| [Perfis de acesso](docs/05-permissoes.md) | Todos |
| [Alinhamento com o front](docs/07-alinhamento-modelo-front.md) | Back-end e Front-end |
| [Replanejamento de setembro](docs/08-replanejamento-setembro.md) | Todos |
| [Operação: log, saúde, backup](docs/09-operacao.md) | DevOps |
| [Plano de testes](qa/01-plano-de-testes.md) | QA |
| [Casos de teste](qa/02-casos-de-teste.md) | QA |
| [Roteiro do QR no celular](qa/05-roteiro-qr-celular.md) | QA |

## Equipe

UX/UI (1) · Front-end (1) · Back-end (2) · DevOps (1) · QA (1)

Reuniões semanais às quintas. Cada ciclo de sete dias fecha com algo
demonstrável, não com relatório de andamento.
