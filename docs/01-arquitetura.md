# Arquitetura

## Visão geral

```
   Navegador do gestor              Celular do participante
            |                                  |
            |  autenticado                     |  sem login
            v                                  v
   +---------------------------------------------------+
   |                  Next.js (Railway)                 |
   |   /painel/*  (protegido)     /checkin/<qr_token>   |
   +---------------------------------------------------+
            |                                  |
            | cookie de sessão                 | Route Handler no servidor
            | (RLS aplica o perfil)            | (função valida o qr_token)
            v                                  v
   +---------------------------------------------------+
   |              PostgreSQL (Railway)                  |
   |   tabelas · RLS · funções de auth e de check-in    |
   +---------------------------------------------------+
```

## Por que Railway com PostgreSQL puro

A equipe já tem prática com a plataforma, e em projeto de sete semanas isso pesa
mais do que qualquer comparação de recursos: o tempo que não se gasta aprendendo
ferramenta volta como funcionalidade entregue.

O preço da escolha é que autenticação e recuperação de senha passam a ser
código nosso — estão em `lib/auth/` e nas funções `auth_*` do banco, com testes.

O que se ganha: o banco local, o de homologação e o de produção são o mesmo
PostgreSQL, sem nenhuma peça que só exista em uma plataforma. E não existe mais
nenhuma chave capaz de ignorar todas as regras de acesso.

## As duas portas de entrada

São caminhos com regras de segurança diferentes, e isso é proposital:

**Painel** — exige login. Cada requisição abre uma transação declarando quem é o
usuário (`set_config('app.usuario_id', …, true)`), e a partir daí o RLS decide o
que aquela pessoa enxerga. Um bug de tela não vira vazamento.

**Check-in público** — não exige login, porque exigir cadastro do participante
mataria a proposta. A página em `/checkin/<qr_token>` chama um Route Handler que
executa `checkin_registrar(...)`, uma função SECURITY DEFINER: ela roda com
privilégio elevado, mas faz **só** o que está escrito nela — validar o token,
conferir a janela, resolver o vínculo da data e gravar. Não existe chave-mestra
para vazar.

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
    checkin/route.js        registra presença via função do banco
lib/
  db/
    pool.js                 pool de conexões (pg)
    consulta.js             consulta() e comUsuario() — a transação com RLS
  auth/
    senha.js                hash e conferência Argon2id
    tokens.js               sorteio e hash de tokens de sessão e recuperação
    sessao.js               abrir, ler, encerrar sessão; exigirUsuario
  dominio/                  regras de negócio e matriz de permissões
  email/enviar.js           adaptador de envio (terminal ou provedor)
components/
db/
  migrations/               histórico versionado do banco
  seed.sql
tests/                      testes SQL de regra de negócio
```

## Linguagem

JavaScript puro, sem etapa de compilação. Os tipos ficam em comentários JSDoc
(`lib/tipos-banco.js` e as assinaturas das funções), lidos pelo editor via
`jsconfig.json` — o `checkJs` está ligado, então erro de digitação em nome de
coluna ou em valor de enum aparece sublinhado enquanto se escreve, sem que o
projeto dependa de TypeScript para rodar ou para publicar.

A verificação que roda no CI é `npm run lint` (ESLint com a configuração do
Next) mais os testes. Não existe `npm run typecheck`.

## Duas regras que não se negociam

**A aplicação nunca conecta como dono do banco.** No PostgreSQL, o dono das
tabelas ignora o RLS. A `DATABASE_URL` da aplicação usa `app_web`, que não é
dono de nada. Migrations e seeds rodam com o usuário dono, por outra variável
(`DATABASE_URL_ADMIN`), e só em script.

**Nada de `lib/db` em componente de cliente.** Há um job de CI que falha se
`DATABASE_URL` ou `lib/db/` aparecerem num arquivo com `"use client"`.

E uma armadilha do próprio PostgreSQL que vale conhecer: quando falta política
de INSERT, ele levanta erro; quando falta a de UPDATE ou DELETE, ele apenas não
enxerga a linha e afeta zero registros, em silêncio. Por isso os testes de
permissão conferem o efeito, não a exceção.

## Decisões de modelagem que a aplicação precisa respeitar

1. **Representante é vínculo, não pessoa.** Ao criar presença, resolva o vínculo
   ativo da pessoa e grave `vinculo_id`, `instituicao_id` e `cargo_no_momento`.
2. **Presença é snapshot.** Nunca derive a instituição de uma presença antiga
   consultando o vínculo atual — use as colunas gravadas na própria presença.
3. **Indicador não se armazena.** Leia sempre das views `vw_*`.
4. **Convidado não tem vínculo.** O banco recusa; a aplicação não deve tentar.
