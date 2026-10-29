# Implantação no domínio oficial — guia para quem vai administrar

Este é o back-end (API) do Sistema de Governança do Fórum CTI. O front-end
(telas) é outro projeto, `centro-inovacao`, em Vite/React. Os dois conversam
por HTTPS. Este guia diz o que é preciso para colocar o back no ar em
qualquer hospedagem e ligá-lo ao front e ao e-mail.

Para conhecer o projeto: [README](../README.md) · [Arquitetura](01-arquitetura.md) ·
[Perfis de acesso](05-permissoes.md) · [Contrato com o front](13-contrato-governanca.md).

## O que precisa

| Item | Versão / observação |
|---|---|
| Node.js | 22 ou mais novo |
| PostgreSQL | 15 ou mais novo (testado no 16) |
| Hospedagem | Qualquer uma que rode `npm run build` + `npm run start` (Railway, Render, VPS com PM2/Docker…). O `railway.json` já deixa o Railway pronto |
| E-mail | Conta na Resend (resend.com) com o domínio verificado |

## Passo a passo

1. **Banco.** Crie o PostgreSQL. Guarde a URL do usuário dono (`postgres`).
2. **Tabelas.** Na pasta do projeto, com `DATABASE_URL_ADMIN` = URL do dono:
   ```bash
   npm ci
   npm run db:migrar        # aplica banco/migrations/001 a 017, uma vez cada
   npm run db:senha-app     # define a senha do usuário app_web (o da aplicação)
   ```
   A aplicação **não** usa o dono: usa `app_web`, que não é dono das tabelas.
   É isso que faz as regras de acesso do banco (RLS) valerem.
3. **Primeiro administrador.**
   ```bash
   node scripts/criar-usuario.mjs "Nome" email@dominio admin
   ```
   A pessoa define a senha pelo link que chega por e-mail (ou que aparece no
   log do servidor enquanto o e-mail não estiver configurado). Daí em diante
   as contas são criadas na tela **Contas e permissões**.
4. **Aplicação.** Configure as variáveis abaixo, rode `npm run build` e
   `npm run start`. Antes de cada deploy, rode `npm run db:migrar` (no
   Railway isso já está no `railway.json` como pre-deploy).
5. **Conferir.** `GET https://API/api/saude` deve responder `"status": "ok"`
   com `"migrations": { "aplicadas": 17 }`.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | Sim | Conexão da aplicação, **com o usuário `app_web`** |
| `DATABASE_URL_ADMIN` | Sim, no deploy | Conexão do dono, usada só pelas migrations |
| `URL_FRONTEND` | Sim | Endereço do front (CORS, link do QR de check-in, links dos e-mails). Mais de um: separados por vírgula; o primeiro é o principal |
| `URL_API` | Recomendada | Endereço público desta API, para os links de download e do QR |
| `SEGREDO_LINKS` | Sim | Assina os links temporários de download. Gere com `openssl rand -hex 32` e não compartilhe |
| `EMAIL_PROVEDOR` | Para e-mail | `resend` |
| `RESEND_API_KEY` | Para e-mail | Chave `re_...` da Resend |
| `EMAIL_REMETENTE` | Para e-mail | Ex.: `Fórum CTI <nao-responda@forum.dominio.org.br>` (do domínio verificado) |
| `ARMAZENAMENTO` | Não | `postgres` (padrão): os arquivos ficam no próprio banco |
| `COOKIE_CROSS_SITE` | Não | A API detecta sozinha front e API em domínios diferentes; `1` força o modo |

Modelo completo e comentado: [`.env.example`](../.env.example).

## Domínio oficial — sugestão

- Front em `forum.dominio.org.br` e API em `api.forum.dominio.org.br`.
  Com os dois **no mesmo domínio**, o cookie de sessão funciona em todos os
  navegadores, inclusive Safari/iPhone (com Vercel x Railway, o Safari
  bloqueia o login por ser cookie de terceiro).
- No front: `VITE_API_URL=https://api.forum.dominio.org.br` e rebuild.
- Na API: `URL_FRONTEND=https://forum.dominio.org.br` e
  `URL_API=https://api.forum.dominio.org.br`.

## E-mail (convites, convocações, recuperação de senha)

1. Na Resend: **Domains → Add Domain** (de preferência um subdomínio, ex.:
   `forum.dominio.org.br`, para não mexer no e-mail que já existe).
2. Cadastre no DNS do domínio os registros que a Resend mostrar (TXT/MX) e
   clique em **Verify**.
3. **API Keys → Create API Key** (permissão de envio) e configure as três
   variáveis de e-mail acima.
4. Teste com "Esqueci minha senha" na tela de login.

Sem provedor configurado o sistema funciona, mas nenhum e-mail sai: as
convocações aparecem com entrega "falhou" e os links de convite ficam no log.

## Trazer os dados que já estão no ar

Se for migrar o banco atual (Railway) para a hospedagem oficial:

```bash
pg_dump --no-owner --format=custom "URL_DO_DONO_ATUAL" > forum.dump
psql "URL_DO_DONO_NOVO" -c "create role app_web nologin"   # o papel é do servidor, não vem no dump
pg_restore --no-owner --dbname "URL_DO_DONO_NOVO" forum.dump
npm run db:senha-app      # define a senha do app_web no banco novo
npm run db:migrar         # confere: deve dizer 0 migrations aplicadas
```

Para cadastros que ainda estão em planilha, use a tela **Importação**
(administrador): CSV UTF-8 separado por `;`, com modelos para baixar na
própria tela. A importação valida tudo antes e só grava se não houver erro.

## Backup e operação

Ver [Operação: log, saúde, backup](09-operacao.md) — inclui como testar a
restauração, que é a metade do backup que costuma faltar.

## Testes

```bash
npm run db:testar         # testes do banco (precisa de DATABASE_URL_ADMIN)
npm test                  # domínio + integração (precisa de DATABASE_URL e DATABASE_URL_ADMIN)
npm run lint
```
