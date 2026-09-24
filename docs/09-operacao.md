# Operação — logs, saúde, backup e deploy

Trilha DevOps. Cobre os cards das Semanas 3, 4 e 5: logs da aplicação,
monitoramento, backup automático e validação do backup.

---

## 1. Logs

Uma linha JSON por evento, no stdout. O Railway indexa stdout automaticamente —
não é preciso configurar nada para os logs aparecerem no painel.

```json
{"nivel":"erro","evento":"erro_inesperado","em":"2026-09-10T13:02:11.402Z",
 "mensagem":"duplicate key value","codigoBanco":"23505","restricao":"instituicao_cnpj_key"}
```

**Níveis e o que cada um significa:**

| Nível | Quando | Quem olha |
|---|---|---|
| `debug` | Detalhe de diagnóstico. Só sai com `LOG_NIVEL=debug` | Quem está depurando |
| `info` | Evento normal que vale registrar | Ninguém, até precisar |
| `aviso` | Erro de negócio: CNPJ repetido, sem permissão, limite estourado | Se acumular, é sinal |
| `erro` | Erro inesperado — defeito | **Alguém precisa olhar** |

A separação entre `aviso` e `erro` é o que faz o log servir para alerta. Se erro
de negócio entrasse como `erro`, o nível encheria de coisa esperada e ninguém
mais olharia.

**O que nunca é escrito:** senha, hash de senha, token de sessão, token de
recuperação e o `qr_token` da reunião. `log.js` remove esses campos por nome
antes de escrever, para o cuidado não depender de quem chama lembrar. O
`qr_token` está na lista porque é a chave que permite registrar presença — no
painel da plataforma ele ficaria legível para gente demais.

Em produção a pilha de erro é omitida. Localmente ela aparece.

---

## 2. Verificação de saúde

```
GET /api/saude
```

```json
{"status":"ok",
 "banco":{"conectado":true,"latenciaMs":12},
 "migrations":{"aplicadas":5,"ultima":"005_protecao_checkin.sql"},
 "aplicacao":{"ambiente":"production","armazenamento":"postgres","noArDesdeSegundos":3841}}
```

Responde `503` com `status: "indisponivel"` quando o banco não responde — 503 é
o código que os monitores entendem como queda temporária.

É a **única rota do painel que responde sem sessão**. Um verificador de saúde
não faz login, e responder 401 para ele faria o monitor acusar queda com o
sistema no ar. Em troca, ela não devolve nenhum dado do ecossistema.

**Configurar no Railway:** Settings → Health Check Path → `/api/saude`. Com
isso o Railway espera a aplicação responder antes de mandar tráfego para uma
versão nova, e um deploy quebrado não derruba o ambiente.

**`migrations.aplicadas`** é o campo mais útil para o QA: se homologação diz 5 e
produção diz 4, os dois ambientes não são o mesmo produto, e um teste que passa
lá pode falhar aqui.

---

## 3. Backup

### Automático

`.github/workflows/backup.yml` roda todo dia às 03:00 de Brasília e guarda o
dump como artefato do GitHub por 30 dias. Também dá para disparar à mão em
Actions → Backup do banco → Run workflow, o que vale fazer **antes de aplicar
migration em produção**.

Precisa do secret `DATABASE_URL_ADMIN_PROD` em
Settings → Secrets and variables → Actions. Sem ele o workflow falha com
mensagem explicando, em vez de gerar um arquivo vazio em silêncio.

### À mão

```bash
DATABASE_URL_ADMIN=postgresql://postgres:...@host:5432/railway ./scripts/backup.sh
```

O script confere o arquivo depois de gerar: `pg_restore --list` lê o índice
interno do dump e falha se ele estiver truncado. É a diferença entre "o comando
não deu erro" e "o arquivo serve".

**O dump usa o usuário DONO, não o `app_web`.** Com `app_web` o RLS esconderia
linhas e o dump sairia incompleto — sem erro nenhum, que é o pior jeito de sair
errado.

**Os documentos estão dentro do dump**, porque moram em `documento_conteudo`
(migration 004). No dia em que o armazenamento virar S3/R2, este backup passa a
cobrir só metade e o bucket precisa do seu.

### Validar — a metade que costuma faltar

Backup que nunca foi restaurado é esperança, não backup.

```bash
# num banco LOCAL, com um dump de homologação
DATABASE_URL_ADMIN=postgresql://postgres:postgres@localhost:5432/teste_restore \
  ./scripts/restaurar.sh backups/ecossistema-20260910-030000.dump
```

O script imprime as contagens de instituições, representantes, reuniões,
presenças e documentos. Se batem com o ambiente de origem, o backup presta.

**Fazer isso pelo menos uma vez antes da entrega**, e anotar o resultado em
`qa/04-registro-de-execucao.md`. É o card "Validação do backup automático" da
Semana 5.

Detalhe que morde: `--no-owner` não traz o papel `app_web` nem a senha dele.
Depois de restaurar num ambiente novo:

```sql
alter role app_web login password '<senha>';
```

---

## 4. Deploy no Railway

### Serviços

| Serviço | O que é |
|---|---|
| `ecossistema-db-homolog` | PostgreSQL 16 |
| `ecossistema-web-homolog` | A aplicação, a partir da branch `develop` |
| `ecossistema-db-prod` | PostgreSQL 16 |
| `ecossistema-web-prod` | A aplicação, a partir da branch `main` |

### Variáveis por serviço web

```
DATABASE_URL=postgresql://app_web:<senha>@<host>:5432/railway
URL_FRONTEND=https://<endereco-do-front>
COOKIE_CROSS_SITE=1
ARMAZENAMENTO=postgres
UPLOAD_LIMITE_BYTES=20971520
NODE_ENV=production
```

`DATABASE_URL_ADMIN` **não** vai no serviço web. Ela é só de script de
migration e de backup, e deixá-la no ambiente da aplicação anularia a separação
que faz o RLS valer: bastaria um bug de configuração para a aplicação passar a
conectar como dono e ignorar todas as políticas.

### Primeira subida de um ambiente

```bash
# 1. migrations, com o usuário dono
DATABASE_URL_ADMIN='<url do postgres>' ./scripts/migrar.sh

# 2. dar login e senha ao app_web (ele nasce sem, de propósito)
psql '<url do postgres>' -c "alter role app_web login password '<senha forte>';"

# 3. criar o primeiro administrador
DATABASE_URL='<url do app_web>' node scripts/criar-usuario.mjs

# 4. conferir
curl https://<subdominio>.up.railway.app/api/saude
```

O passo 2 é o que mais se esquece. Sem ele a aplicação sobe e falha em toda
requisição com erro de autenticação do banco — e a mensagem não deixa óbvio que
o que falta é isso.

### A cada deploy

O CI (`.github/workflows/aplicacao.yml`) roda lint, testes de domínio e build a
cada push. Merge em `develop` publica em homologação; merge em `main` publica em
produção.

**Migration nova não é aplicada pelo deploy.** É passo manual, de propósito:
uma migration que roda sozinha no meio de um deploy que depois falha deixa banco
e código em versões diferentes, e ninguém percebe até a primeira consulta
quebrar. A ordem é: backup → migrations → deploy → conferir `/api/saude`.

---

## 5. Se der problema

| Sintoma | Onde olhar primeiro |
|---|---|
| Tudo responde 500 | `/api/saude`. Se der 503, é o banco |
| "password authentication failed" no log | O `app_web` não tem senha neste ambiente (passo 2) |
| Rota nova dá 404 em produção | O deploy pegou? Confira o commit publicado no Railway |
| Consulta que funciona local volta vazia | RLS. A aplicação está conectando sem usuário declarado |
| Migration falhou no meio | Restaure o backup. Migration não roda pela metade — cada arquivo é uma transação |
| Check-in devolve 429 | Limite por IP (RNF14). Normal num teste de carga; suspeito em uso real |
