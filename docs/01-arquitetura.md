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
código nosso — estão em `src/infraestrutura/seguranca/` e nas funções `auth_*` do banco, com testes.

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

## Organização de pastas

Arquitetura em camadas. Detalhe arquivo por arquivo em `docs/06-mapa-do-projeto.md`.

```
banco/
  migrations/001_estrutura_inicial.sql   o banco inteiro, em 10 partes
  seed.sql                               dados de exemplo
src/
  app/                    ① apresentação — rotas e telas do Next.js
    (acesso)/             login, recuperação e redefinição de senha
    (painel)/             área autenticada
    api/                  rotas HTTP (check-in, encerramentos)
  aplicacao/              ② casos de uso — um arquivo por ação do sistema
    autenticacao/  checkin/  reunioes/  vinculos/
  dominio/                ③ regras — permissoes.js, erros.js, tipos.js
  infraestrutura/         ④ ferramentas
    banco/  seguranca/  email/  http/
  middleware.js           barreira de cookie antes do painel
testes/
  banco/  dominio/  integracao/
scripts/                  migrar, resetar, testar, criar usuário
```

A regra de dependência: apresentação → aplicação → domínio. `src/dominio/` não
importa nada, de ninguém. Se um dia importar, a camada vazou.

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

**Nada de `src/infraestrutura/banco` em componente de cliente.** Há um job de CI que falha se
`DATABASE_URL` ou `infraestrutura/banco/` aparecerem num arquivo com `"use client"`.

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
