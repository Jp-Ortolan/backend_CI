# Ambientes e infraestrutura — Railway

Trilha DevOps · atualizado em 20/08/2026

## Por que Railway

A equipe já tem prática com a plataforma. Em projeto de sete semanas, ferramenta
conhecida vale mais do que ferramenta teoricamente melhor: o tempo economizado
em aprendizado volta como funcionalidade entregue.

O que veio junto com a escolha:

| | Antes (plataforma gerenciada) | Agora (Railway) |
|---|---|---|
| Banco | PostgreSQL gerenciado | PostgreSQL gerenciado |
| Autenticação | Pronta | **Nossa** — Argon2id, tabela de sessão, cookie httpOnly |
| Recuperação de senha | Pronta, com e-mail | **Nossa**, com token expirável; envio precisa de provedor |
| Controle de acesso no banco | `auth.uid()` nativo | `current_setting('app.usuario_id')` |
| Arquivos (atas, documentos) | Storage pronto | Fora do MVP; quando entrar, S3 ou volume |

Duas coisas ficaram **mais simples**: sumiu a chave que ignorava todas as regras
de acesso, e o banco local passou a ser idêntico ao de produção — antes era
preciso simular um schema que só existia na plataforma.

## Os três ambientes

| Ambiente | Banco | Aplicação | Quem usa |
|---|---|---|---|
| Local | PostgreSQL na máquina ou em Docker | `npm run dev` | Desenvolvedores |
| Homologação | Projeto Railway `ecossistema-homolog` | Railway, branch `develop` | QA e Centro de Inovação |
| Produção | Projeto Railway `ecossistema-prod` | Railway, branch `main` | Uso real |

Dois projetos separados. O QA precisa poder apagar tudo e recomeçar sem medo.

---

## Os dois usuários do banco — a parte que não pode ser pulada

O Railway cria um usuário `postgres`, que é **dono** de tudo. E no PostgreSQL o
dono das tabelas **ignora o RLS por padrão**.

Se a aplicação conectar como `postgres`, todas as políticas de acesso viram
enfeite: qualquer bug de consulta passa a enxergar qualquer dado.

Por isso existem dois usuários:

| Usuário | Para quê | Onde aparece |
|---|---|---|
| `postgres` (dono) | Rodar migrations e seeds | `DATABASE_URL_ADMIN`, só em script |
| `app_web` (não é dono) | A aplicação | `DATABASE_URL`, usada pelo Next.js |

A migration `007` cria o papel `app_web` sem senha e sem permissão de login —
definir a senha é ato do DevOps, para ela não ficar no repositório:

```sql
alter role app_web with login password 'uma-senha-forte-aqui';
```

Depois disso, a `DATABASE_URL` da aplicação usa `app_web`:

```
postgresql://app_web:SENHA@containers-us-west-1.railway.app:6543/railway
```

Existe um teste automatizado que conecta como `app_web` e confere que, sem
usuário declarado, o banco não devolve nada. Se alguém apontar a aplicação para
o usuário dono, esse teste continua passando — mas a proteção some. **Confira a
`DATABASE_URL` de produção com os olhos.**

---

## Passo a passo da criação

### 1. Projeto e banco

No Railway: **New Project → Provision PostgreSQL**. Faça duas vezes,
`ecossistema-homolog` e `ecossistema-prod`.

Na aba **Variables** do serviço Postgres estão `DATABASE_URL`, `PGHOST`,
`PGUSER`, `PGPASSWORD` e `PGDATABASE`. Guarde.

### 2. Aplicar as migrations

Da sua máquina, apontando para o banco de homologação:

```bash
export DATABASE_URL_ADMIN="postgresql://postgres:SENHA@HOST:PORTA/railway"
./scripts/migrar.sh
```

O script mantém uma tabela `migration_aplicada`: cada arquivo roda uma vez só, e
rodar de novo não faz nada. Existe um job de CI que confere justamente isso.

### 3. Criar a senha do app_web

```bash
psql "$DATABASE_URL_ADMIN" -c "alter role app_web with login password 'SENHA_FORTE';"
```

Guarde essa senha no cofre de variáveis do Railway, não no repositório.

### 4. Criar o primeiro administrador

O sistema não tem tela de cadastro de propósito. O primeiro acesso é criado na mão:

```bash
node scripts/criar-usuario.mjs "Ana Gestora" ana@centroinovacao.br admin
```

O script pede a senha, gera o hash Argon2id e insere. A senha nunca passa por
argumento de linha de comando — argumento fica no histórico do terminal.

### 5. Publicar a aplicação

**New → GitHub Repo**, escolha o repositório. O Railway detecta Next.js sozinho.

Variáveis do serviço da aplicação:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | string com o usuário **app_web** |
| `URL_FRONTEND` | a URL pública do **front-end**: origem liberada no CORS, base do QR e do link de senha |
| `COOKIE_CROSS_SITE` | `1` só quando front e API ficam em domínios diferentes |
| `EMAIL_PROVEDOR` | `resend` quando houver conta; sem ela, o link sai no log |
| `RESEND_API_KEY` | chave do provedor |
| `EMAIL_REMETENTE` | remetente verificado |

Em **Settings → Environments**, ligue `develop` ao projeto de homologação e
`main` ao de produção.

---

## Subir o ambiente local

Com Docker:

```bash
docker run --name eco-pg -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 -d postgres:16

export DATABASE_URL_ADMIN="postgresql://postgres:postgres@localhost:5432/postgres"
./scripts/resetar.sh
```

Sem Docker, use um PostgreSQL instalado na máquina — a única exigência é ser 15
ou maior, porque as migrations usam colunas geradas.

Conferir que está tudo de pé:

```bash
npm run db:testar      # 36 testes no banco
npm run test:dominio   # 11 testes da matriz de permissões
```

---

## Backup (RNF20)

O Railway faz snapshot do volume, mas snapshot de volume não é backup de banco:
não dá para restaurar uma tabela só, nem levar o dado para outro lugar. Como o
histórico do ecossistema é o ativo do projeto, vale um dump semanal guardado
fora da plataforma:

```bash
pg_dump "$DATABASE_URL_ADMIN" -Fc -f backup-$(date +%F).dump
```

**Testar a restauração uma vez antes de 30/09.** Backup nunca restaurado não é
backup — é esperança. Fica como card da Semana 6.

---

## Monitoramento

- Railway: aba **Observability** do serviço, com CPU, memória e logs.
- Antes da primeira reunião real com QR Code, acompanhar as conexões durante o
  check-in — é o único pico previsível do sistema (RNF09). O pool está limitado
  a 10 conexões por instância (`DB_MAX_CONEXOES`).
