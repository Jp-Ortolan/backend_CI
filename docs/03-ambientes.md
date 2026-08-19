# Ambientes e infraestrutura — trilha DevOps

## Os três ambientes

| Ambiente | Banco | Aplicação | Quem usa |
|---|---|---|---|
| Local | Supabase CLI (Docker) na máquina de cada um | `npm run dev` | Desenvolvedores |
| Homologação | Projeto Supabase `ecossistema-homolog` | Vercel, branch `develop` | QA e Centro de Inovação |
| Produção | Projeto Supabase `ecossistema-prod` | Vercel, branch `main` | Uso real |

Dois projetos Supabase separados. Não usar o mesmo projeto com schemas
diferentes: o QA precisa poder apagar tudo e recomeçar sem medo.

## Passo a passo da criação (ordem sugerida)

**1. Repositório**
```bash
gh repo create centro-inovacao/ecossistema-inovacao --private --source=. --push
```
Depois, em Settings → Branches: proteger `main` e `develop` exigindo PR e CI verde.

**2. Projetos Supabase**
Criar `ecossistema-homolog` e `ecossistema-prod` na região `sa-east-1` (São Paulo)
— latência menor e dado pessoal fica no Brasil, o que simplifica a conversa de LGPD.
Guardar de cada um: Project URL, anon key, service role key, senha do banco.

**3. Secrets do GitHub** (Settings → Secrets and variables → Actions)

| Secret | Origem |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Conta Supabase → Access Tokens |
| `SUPABASE_PROJECT_REF_HOMOLOG` | Ref do projeto de homologação |
| `SUPABASE_PROJECT_REF_PROD` | Ref do projeto de produção |
| `SUPABASE_DB_PASSWORD_HOMOLOG` | Senha definida na criação |
| `SUPABASE_DB_PASSWORD_PROD` | Senha definida na criação |

**4. Vercel**
Importar o repositório. Production Branch = `main`. As variáveis de `.env.example`
entram em Environment Variables, com valores diferentes por ambiente:
Production ← projeto prod; Preview e Development ← projeto homolog.

`SUPABASE_SERVICE_ROLE_KEY` **sem** o prefixo `NEXT_PUBLIC_`. Com o prefixo, ela
vai para o navegador e todo o RLS deixa de valer.

## Subir o ambiente local

```bash
npm install -g supabase
supabase init
supabase start          # primeira vez demora: baixa as imagens
supabase db reset       # aplica migrations + seed
```

Saída útil do `supabase start`: API `http://127.0.0.1:54321`,
banco `postgresql://postgres:postgres@127.0.0.1:54322/postgres`,
Studio `http://127.0.0.1:54323`.

Conferir se está tudo de pé:
```bash
./scripts/testar-banco.sh
```

## Publicar migrations

```bash
supabase link --project-ref <ref-do-projeto>
supabase db push
```

Homologação primeiro, sempre. Produção só depois do QA aprovar.

## Backup (RNF20)

O plano gratuito do Supabase faz backup diário com retenção curta. Como o
histórico do ecossistema é o ativo do projeto, vale um dump semanal guardado
fora do Supabase:

```bash
supabase db dump --db-url "$DATABASE_URL_PROD" -f backup-$(date +%F).sql
```

Vale mais ainda **testar a restauração uma vez** antes de 30/09 — backup nunca
testado não é backup. Deixar isso como card da Semana 6.

## Monitoramento

- Vercel: Analytics e Logs já vêm ligados.
- Supabase: Logs & Reports para erro de query e uso de conexão.
- Antes da primeira reunião real com QR Code, olhar o gráfico de conexões
  durante o check-in — é o único momento de pico previsível do sistema (RNF09).
