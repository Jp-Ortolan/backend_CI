# Arquitetura

## Visão geral

```
   Navegador do gestor              Celular do participante
            |                                  |
            |  autenticado                     |  sem login
            v                                  v
   +---------------------------------------------------+
   |                  Next.js (Vercel)                  |
   |   /painel/*  (protegido)     /checkin/<qr_token>   |
   +---------------------------------------------------+
            |                                  |
            | anon key + JWT                   | Route Handler no servidor
            | (RLS aplica o perfil)            | (service role, valida o token)
            v                                  v
   +---------------------------------------------------+
   |                     Supabase                       |
   |   Postgres  |  Auth  |  Storage  |  Edge Functions |
   +---------------------------------------------------+
```

## Por que Supabase

O sistema é 90% CRUD sobre um modelo relacional, mais um punhado de consultas
agregadas. Um back-end próprio significaria reescrever autenticação, controle de
permissão e camada de acesso a dados — trabalho que não cabe em sete semanas e
que não é o diferencial do projeto. O diferencial é o fluxo de check-in.

O que ganhamos de pronto: autenticação com recuperação de senha, permissão na
camada de dados via RLS, storage de arquivos com política de acesso, e um
Postgres de verdade (com enum, constraint, view e índice trigram) em vez de um
banco genérico.

## As duas portas de entrada

São caminhos com regras de segurança diferentes, e isso é proposital:

**Painel** — exige login. O cliente usa a `anon key`; quem decide o que cada
pessoa enxerga é o RLS, não o front-end. Um bug de tela não vira vazamento.

**Check-in público** — não exige login, porque exigir cadastro do participante
mataria a proposta. A página em `/checkin/<qr_token>` chama um Route Handler no
servidor, que valida o token e a janela de horário antes de gravar. A `service
role key` só existe nesse caminho e nunca chega ao navegador.

## Organização de pastas (proposta)

```
app/
  (painel)/                 rotas autenticadas
    dashboard/
    instituicoes/
    representantes/
    reunioes/
  checkin/[token]/          página pública de check-in
  api/
    checkin/route.ts        grava presença com service role
lib/
  supabase/
    cliente.ts              browser client (anon)
    servidor.ts             server client (anon + cookies)
    admin.ts                service role — importar SÓ em código de servidor
  dominio/                  regras de negócio em TypeScript
  tipos.ts                  gerado por: supabase gen types typescript
components/
supabase/
  migrations/               histórico versionado do banco
  seed.sql
tests/                      testes SQL de regra de negócio
```

## Regra que não se negocia

`lib/supabase/admin.ts` (service role) só pode ser importado em Route Handler,
Server Action ou Edge Function. Se aparecer num componente de cliente, a chave
que ignora todo o RLS vai para o navegador.

Sugestão para o DevOps: incluir no CI uma verificação que falhe se
`SUPABASE_SERVICE_ROLE_KEY` aparecer em arquivo com `"use client"`.

## Decisões de modelagem que a aplicação precisa respeitar

1. **Representante é vínculo, não pessoa.** Ao criar presença, resolva o vínculo
   ativo da pessoa e grave `vinculo_id`, `instituicao_id` e `cargo_no_momento`.
2. **Presença é snapshot.** Nunca derive a instituição de uma presença antiga
   consultando o vínculo atual — use as colunas gravadas na própria presença.
3. **Indicador não se armazena.** Leia sempre das views `vw_*`.
4. **Convidado não tem vínculo.** O banco recusa; a aplicação não deve tentar.
