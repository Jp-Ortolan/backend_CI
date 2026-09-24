# Deploy no Railway — passo a passo

Testado até onde dá sem a conta: migrations, build e servidor foram rodados
contra um PostgreSQL 16 de verdade em 24/09/2026. O que falta é só a conta.

## A ordem importa

A aplicação conecta com `app_web`, que **não é dono** das tabelas — é isso que
faz o RLS valer. Esse papel nasce junto com as migrations e sem senha. Por isso
o banco vai primeiro e a aplicação depois: assim ela nunca chega a rodar como
dono, nem por um deploy.

## 1 · Criar o banco

No Railway: **New Project → Provision PostgreSQL**.

Abra o serviço Postgres → aba **Variables** → copie a `DATABASE_PUBLIC_URL`
(a que tem `containers-us-west...` ou `.proxy.rlwy.net`, não a `.internal`).

## 2 · Aplicar as migrations, da sua máquina

No PowerShell, dentro da pasta do projeto:

```powershell
$env:DATABASE_URL_ADMIN = "<cole a DATABASE_PUBLIC_URL aqui>"
npm run db:migrar
```

Devem sair 6 migrations aplicadas. Rodar de novo não repete nada.

## 3 · Dar senha ao app_web

Ainda no PowerShell, no mesmo `DATABASE_URL_ADMIN`:

```powershell
npm run db:senha-app
```

Se preferir, dá para fazer pelo console de query do próprio Railway:

```sql
alter role app_web login password '<a mesma senha>';
```

Guarde essa senha: ela vira a `DATABASE_URL` da aplicação, e não vai para o Git.

## 4 · Dados de exemplo (opcional, mas ajuda a demonstrar)

```powershell
npm run db:semear
```

Cria as três contas de acesso (uma de cada perfil). Os e-mails e a senha estão
em `banco/seed.sql`. **Não rode isso depois que houver dado real.**

## 5 · Criar o serviço da aplicação

**New → GitHub Repo → `Jp-Ortolan/backend_CI`**, branch `develop`.

O `railway.json` na raiz já diz o resto: build com Nixpacks, migrations antes de
cada deploy, start, e verificação de saúde em `/api/saude`.

## 6 · Variáveis do serviço da aplicação

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a URL do banco **trocando o usuário e a senha por `app_web`** |
| `DATABASE_URL_ADMIN` | `${{Postgres.DATABASE_URL}}` — usada só pelas migrations |
| `URL_FRONTEND` | o endereço do front (ex.: `https://centro-inovacao.vercel.app`) |
| `COOKIE_CROSS_SITE` | `1` |
| `ARMAZENAMENTO` | `postgres` |
| `UPLOAD_LIMITE_BYTES` | `20971520` |

Sobre a `DATABASE_URL`: pegue a interna (`postgres.railway.internal`) e troque o
começo. De `postgresql://postgres:SENHA@postgres.railway.internal:5432/railway`
para `postgresql://app_web:SUA_SENHA@postgres.railway.internal:5432/railway`.

**`COOKIE_CROSS_SITE=1` não é opcional aqui.** Front e API ficam em domínios
diferentes (`vercel.app` e `railway.app`), e nesse caso o navegador só manda o
cookie de sessão se ele for `SameSite=none`. Sem isso o login "funciona" e a
próxima requisição volta 401 — o erro mais confuso possível de diagnosticar.

Não precisa definir `PORT`: o Railway define, e o Next respeita.

## 7 · Conferir

```
GET https://<seu-app>.up.railway.app/api/saude
```

Deve responder:

```json
{
  "status": "ok",
  "banco": { "conectado": true, "latenciaMs": 2 },
  "migrations": { "aplicadas": 6, "ultima": "006_campos_das_telas.sql" },
  "aplicacao": { "ambiente": "production", "armazenamento": "postgres" }
}
```

Se `conectado` vier `false`, a `DATABASE_URL` está errada. Se `aplicadas` vier
menos que 6, o passo 2 não terminou.

## 8 · Avisar a front-end

Mande para ela o endereço e o [guia de integração](10-integracao-front.md).
Assim que ela publicar o front, volte aqui e ajuste `URL_FRONTEND` — é essa
variável que libera a origem no CORS. Enquanto estiver errada, **toda** chamada
dela é bloqueada pelo navegador.

## Backup

`.github/workflows/backup.yml` faz o dump diário, mas só depois que existir o
secret `DATABASE_URL_ADMIN_PROD` no GitHub (Settings → Secrets and variables →
Actions), com a mesma URL do passo 2. Detalhes em [09-operacao.md](09-operacao.md).
