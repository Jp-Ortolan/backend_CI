# Sistema de Gestão do Ecossistema de Inovação

Plataforma web para centralizar a base do ecossistema do Centro de Inovação —
instituições, representantes, vínculos, reuniões e presenças — e automatizar o
registro de participação por QR Code.

**Entrega da primeira versão: 30/09/2026.**

---

## Começar aqui

```bash
git clone <url-do-repositorio>
cd ecossistema-inovacao

npm install                    # dependências da aplicação
npm install -g supabase        # CLI, uma vez por máquina

supabase init
supabase start                 # precisa do Docker aberto
supabase db reset              # aplica migrations + seed

cp .env.example .env.local     # preencher com o que o "supabase start" imprimiu

npm run test:dominio           # testes das regras em TypeScript
npm run db:testar              # testes das regras no banco
npm run dev                    # http://localhost:3000
```

Studio local: `http://127.0.0.1:54323`

Sem Docker? Dá para usar um Postgres comum:

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=suasenha \
STUB=1 ./scripts/testar-banco.sh
```

O `STUB=1` cria um `auth.uid()` falso, porque essa função só existe no Supabase.

---

## O que tem aqui

| Pasta | Conteúdo | Trilha |
|---|---|---|
| `app/api/` | Route Handlers: check-in, encerrar vínculo, encerrar reunião | Back-end |
| `lib/supabase/` | Clientes do Supabase (navegador, servidor e admin) | Back-end |
| `lib/dominio/` | Regras de negócio em TypeScript e formato de erro | Back-end |
| `supabase/migrations/` | Estrutura do banco, versionada | Back-end |
| `supabase/seed.sql` | Dados de exemplo para desenvolvimento | Back-end |
| `tests/` | Testes SQL de regra de negócio e testes TypeScript do domínio | QA + Back-end |
| `scripts/` | `testar-banco.sh` e o stub de auth local | DevOps |
| `.github/workflows/` | CI: migrations, testes e verificação da aplicação | DevOps |
| `docs/` | Arquitetura, padrões de Git, ambientes e contrato de API | Todas |
| `qa/` | Plano de testes, 45 casos, definição de pronto | QA |

---

## Documentos

| Documento | Para quem |
|---|---|
| [Arquitetura](docs/01-arquitetura.md) | Todos — leitura obrigatória antes do primeiro PR |
| [Git e branches](docs/02-git-e-branches.md) | Todos |
| [Ambientes e infraestrutura](docs/03-ambientes.md) | DevOps |
| [Contrato de API](docs/04-contrato-de-api.md) | Back-end e Front-end |
| [Plano de testes](qa/01-plano-de-testes.md) | QA |
| [Casos de teste](qa/02-casos-de-teste.md) | QA |
| [Definição de pronto](qa/03-definicao-de-pronto.md) | Todos |

---

## As quatro regras do modelo

Valem para qualquer código que toque o banco:

1. **Representante é vínculo, não pessoa.** A pessoa existe sozinha; o que a liga
   a uma instituição é a tabela `vinculo`, com período. Encerrar vínculo nunca
   apaga linha.
2. **Presença é snapshot.** No check-in, copie `vinculo_id`, `instituicao_id` e
   `cargo_no_momento`. Nunca deduza a instituição de uma presença antiga pelo
   vínculo atual.
3. **Indicador não se armazena.** Percentual e totais saem das views `vw_*`.
4. **Convidado não tem vínculo.** O banco recusa — a aplicação não deve tentar.

A regra 2 é a menos óbvia e a mais cara de corrigir depois: sem ela, cada troca
de instituição reescreve o histórico das reuniões passadas.

---

## Mexer no banco

```bash
supabase migration new descricao_curta   # cria o arquivo com timestamp
# escrever o SQL
supabase db reset                        # recria do zero e valida
./scripts/testar-banco.sh                # roda os testes
```

**Nunca edite uma migration já aplicada em outro ambiente.** Crie uma nova. O CI
recusa nome fora do padrão e timestamp repetido.

Regra de negócio nova pede teste novo em `tests/`. É o que impede uma regressão
silenciosa no cálculo de participação.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe a aplicação em desenvolvimento |
| `npm run test:dominio` | 11 testes das regras de negócio em TypeScript |
| `npm run db:testar` | 17 testes de regra e indicadores direto no banco |
| `npm run db:reset` | Recria o banco local com migrations + seed |
| `npm run db:tipos` | Regenera `lib/tipos-banco.ts` a partir do banco local |
| `npm run typecheck` | Verificação de tipos sem gerar build |

---

## Rotas já implementadas

| Rota | Método | Requisito |
|---|---|---|
| `/api/checkin/[token]` | GET | RF27 — dados públicos da reunião |
| `/api/checkin/[token]` | POST | RF29 a RF34 — registrar presença |
| `/api/checkin/[token]/buscar` | GET | RF28 — buscar participante pelo nome |
| `/api/vinculos/[id]/encerrar` | POST | RF16 — encerrar vínculo |
| `/api/reunioes/[id]/encerrar` | POST | RF39 — encerrar e marcar ausentes |

O CRUD comum (instituições, representantes, reuniões, indicadores) sai direto
pelo SDK do Supabase com RLS — não precisa de rota própria. Ver
[contrato de API](docs/04-contrato-de-api.md).

---

## Stack

Next.js (App Router) · Supabase (PostgreSQL, Auth, Storage) · Vercel · GitHub Actions

## Equipe

UX/UI (1) · Front-end (1) · Back-end (2) · DevOps (1) · QA (1)

Reuniões semanais às quintas. Cada ciclo de sete dias fecha com algo
demonstrável, não com relatório de andamento.
