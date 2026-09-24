# Mapa do projeto — arquitetura e o que faz cada arquivo

Documento de referência: qual padrão de arquitetura o projeto segue, por quê, e
o que cada arquivo faz. Serve para quem chega agora e para consultar depois.

---

## 1. Qual padrão de arquitetura foi usado

**Arquitetura em camadas (Layered Architecture)**, organizada pela regra de
dependência da **Clean Architecture**: as camadas de fora conhecem as de dentro,
nunca o contrário.

```
        ┌──────────────────────────────────────────────┐
        │  APRESENTAÇÃO          src/app/              │
        │  telas, rotas HTTP, formulários              │
        └───────────────────┬──────────────────────────┘
                            │ chama
        ┌───────────────────▼──────────────────────────┐
        │  APLICAÇÃO             src/aplicacao/        │
        │  casos de uso: "entrar", "registrar          │
        │  presença", "encerrar reunião"               │
        └───────┬──────────────────────────┬───────────┘
                │ usa regras               │ usa ferramentas
        ┌───────▼──────────────┐  ┌────────▼───────────┐
        │  DOMÍNIO             │  │  INFRAESTRUTURA    │
        │  src/dominio/        │  │  src/infraestrutura│
        │  regras e vocabulário│  │  banco, e-mail,    │
        │  do negócio          │  │  senha, sessão     │
        └──────────────────────┘  └────────┬───────────┘
                                           │
                                  ┌────────▼───────────┐
                                  │  PostgreSQL        │
                                  │  banco/migrations/ │
                                  └────────────────────┘
```

### O que cada camada pode e não pode

| Camada | Pode | Não pode |
|---|---|---|
| **Apresentação** | Ler URL, corpo, formulário; devolver HTML ou JSON | Conter regra de negócio ou SQL |
| **Aplicação** | Orquestrar: validar entrada, chamar domínio e infraestrutura, na ordem | Saber que existe HTTP, cookie ou React |
| **Domínio** | Definir regras e vocabulário (perfis, permissões, erros) | Importar qualquer coisa — não depende de nada |
| **Infraestrutura** | Falar com PostgreSQL, e-mail, criptografia | Decidir regra de negócio |

O teste prático: **`src/dominio/` não importa nada.** Nenhum `import` de `pg`,
de `next`, de biblioteca externa. Por isso os 11 testes da matriz de permissões
rodam em milissegundos, sem banco e sem servidor.

### Por que este padrão, e não outro

Hexagonal (ports & adapters) ou DDD completo seriam exagero para um sistema de
sete semanas com seis pessoas: a cerimônia custaria mais do que resolve. Em
camadas se ganha o essencial — regra separada de tela, negócio separado de
banco — sem inventar interface para tudo.

### Uma peça fora do desenho comum: o banco também tem regra

Normalmente o banco é só armazenamento. Aqui não: **as regras de acesso e as
operações públicas vivem dentro do PostgreSQL**, em Row Level Security e em
funções `SECURITY DEFINER`.

O motivo é que interface não é controle de acesso. Se a permissão morasse só no
JavaScript, bastaria uma requisição feita fora da tela para passar por cima.
Como está, mesmo quem conectar direto no banco com o usuário da aplicação
esbarra na mesma regra.

Isso significa que a matriz de permissões existe **em dois lugares de
propósito**: em `src/dominio/permissoes.js` (para a tela mostrar ou esconder) e
nas políticas de RLS da migration (para valer de verdade). Mudou uma, muda a
outra — está escrito nos dois arquivos.

---

## 2. Estrutura de pastas

```
ecossistema-inovacao/
├── banco/                      TUDO que é PostgreSQL
│   ├── migrations/
│   │   └── 001_estrutura_inicial.sql
│   └── seed.sql
│
├── src/                        TODO o código da aplicação
│   ├── app/                    ① APRESENTAÇÃO
│   ├── aplicacao/              ② CASOS DE USO
│   ├── dominio/                ③ REGRAS DE NEGÓCIO
│   ├── infraestrutura/         ④ FERRAMENTAS
│   └── middleware.js
│
├── testes/
│   ├── banco/                  36 testes em SQL
│   ├── dominio/                11 testes da matriz de permissões
│   └── integracao/             8 testes de autenticação
│
├── scripts/                    comandos de banco e de administração
├── docs/                       documentação técnica
├── qa/                         plano e casos de teste da trilha de QA
└── .github/workflows/          integração contínua
```

---

## 3. O que faz cada arquivo

### banco/ — o PostgreSQL

| Arquivo | O que faz |
|---|---|
| `migrations/001_estrutura_inicial.sql` | **Cria o banco inteiro.** Dividido em 10 partes: extensões e tipos · usuários e sessões · cadastro · operação · triggers · views de indicador · controle de acesso (RLS) · funções de login · funções de check-in · carga inicial. Aplicar num banco vazio deixa tudo de pé. |
| `seed.sql` | Dados de exemplo para desenvolver e demonstrar: 5 instituições, pessoas, vínculos, reuniões, presenças e 3 usuários de teste. **Nunca roda em produção.** |

> **Regra de ouro:** migration já aplicada não se edita. Mudança nova vira
> `banco/migrations/002_descricao.sql`.

### src/app/ — ① Apresentação

Rotas HTTP do Next.js — **e nada além disso**. Em 10/09/2026 as telas saíram do
projeto: a equipe responde só pelo back-end e o front é outro repositório.
`src/app/` tem uma única pasta, `api/`, e cada `route.js` vira um endereço.

| Arquivo | O que faz |
|---|---|
| `api/sessao/route.js` | POST entra (RF01) · GET quem está logado · DELETE sai |
| `api/senha/recuperar/route.js` | Pede o link de recuperação (RF02) |
| `api/senha/redefinir/route.js` | Grava a nova senha (RF02) |
| `api/checkin/[token]/route.js` | GET dados da reunião · POST registra presença |
| `api/checkin/[token]/buscar/route.js` | Busca o participante pelo nome |
| `api/reunioes/[id]/encerrar/route.js` | Encerra a reunião |
| `api/vinculos/[id]/encerrar/route.js` | Encerra o vínculo |

### src/aplicacao/ — ② Casos de uso

Um arquivo por ação que o sistema sabe executar. Recebe dados simples, devolve
dados simples, não sabe o que é HTTP.

| Arquivo | O que faz |
|---|---|
| `autenticacao/entrar.js` | Confere e-mail e senha e abre a sessão (RF01) |
| `autenticacao/recuperar-senha.js` | Gera o link de recuperação e grava a nova senha (RF02) |
| `checkin/consultar-reuniao.js` | Dados públicos da reunião pelo QR Code (RF27) |
| `checkin/buscar-participante.js` | Acha a pessoa pelo nome, sem exigir login (RF28) |
| `checkin/registrar-presenca.js` | Grava a presença, seja representante ou convidado (RF29–RF34) |
| `reunioes/encerrar-reuniao.js` | Fecha a reunião e marca ausentes (RF39) |
| `vinculos/encerrar-vinculo.js` | Encerra o vínculo sem apagar histórico (RF16) |

### src/dominio/ — ③ Regras de negócio

Não importa nada. É o coração do sistema.

| Arquivo | O que faz |
|---|---|
| `permissoes.js` | **Matriz de permissões (RF03).** Quem pode ver, criar, editar, encerrar, excluir e exportar cada recurso. Monta o menu de cada perfil |
| `erros.js` | Catálogo de erros de negócio com código estável e status HTTP. É contrato com o front-end |
| `tipos.js` | Vocabulário das tabelas em JSDoc: status de instituição, tipos de participante, perfis. Só comentários — o editor lê, o Node ignora |

### src/infraestrutura/ — ④ Ferramentas

| Arquivo | O que faz |
|---|---|
| `banco/pool.js` | Pool de conexões com o PostgreSQL. Decide sozinho se usa TLS (Railway sim, local não) |
| `banco/consulta.js` | **A porta de entrada do banco.** `comUsuario()` abre a transação declarando quem é o usuário — é o que faz o RLS funcionar |
| `banco/traduzir-erros.js` | Converte exceção do PostgreSQL em erro de negócio com mensagem em português |
| `seguranca/senha.js` | Hash e conferência com Argon2id |
| `seguranca/tokens.js` | Sorteio e hash de tokens de sessão e de recuperação |
| `seguranca/sessao.js` | Abrir, ler e encerrar sessão; `exigirUsuario()` e `exigirPermissao()` |
| `email/enviar.js` | Adaptador de e-mail: sem provedor configurado, imprime no terminal |
| `http/resposta.js` | Formata sucesso e erro no formato do contrato de API |

### src/middleware.js

Barreira rápida: quem não tem cookie de sessão não carrega o painel. Roda no
Edge, onde não há banco — então confere só a **presença** do cookie. A
validação de verdade acontece em `exigirUsuario()`, no servidor.

### scripts/

| Arquivo | O que faz |
|---|---|
| `migrar.sh` | Aplica as migrations que ainda não rodaram. Guarda numa tabela o que já aplicou |
| `resetar.sh` | Apaga e recria o banco com seed. **Recusa rodar fora de localhost** |
| `testar-banco.sh` | Cria um banco descartável, aplica tudo e roda os 36 testes SQL |
| `criar-usuario.mjs` | Cria o primeiro administrador. Pede a senha sem mostrar na tela |

### testes/

| Pasta | O que cobre |
|---|---|
| `banco/01-regras-de-negocio.sql` | Constraints: convidado sem vínculo, data fim ≥ início, presença única |
| `banco/02-indicadores.sql` | As views calculam o que deveriam |
| `banco/03-seguranca.sql` | Conecta como `app_web` e prova que o RLS barra |
| `banco/04-checkin.sql` | Check-in ponta a ponta, incluindo o vínculo da época |
| `dominio/permissoes.test.js` | Gestor não exclui, consulta não escreve, menu correto |
| `integracao/autenticacao.test.js` | Hash confere, sessão vale, token de recuperação gasta |

---

## 4. Como um pedido atravessa o sistema

Exemplo — o participante lê o QR Code e confirma presença:

```
1. Celular          POST /api/checkin/abc123
2. middleware.js    rota pública → deixa passar
3. route.js         lê o token da URL e o corpo → chama o caso de uso
4. registrar-presenca.js
                    valida o formato (Zod) → chama a função do banco
5. checkin_registrar()  ← AQUI está a regra
                    reunião existe? janela aberta? qual vínculo valia
                    NA DATA? já registrou antes?
                    grava o snapshot: vínculo, instituição e cargo do momento
6. traduzir-erros.js  se o banco recusou, vira mensagem em português
7. resposta.js      vira JSON com o status HTTP certo
```

Repare que o passo 5 é o único que decide alguma coisa. Os outros transportam.
É esse desenho que faz a regra valer mesmo se alguém chamar a API por fora da
tela.

---

## 5. As três decisões de modelagem que sustentam o resto

1. **Representante não é uma entidade — é um vínculo.** Uma linha ligando
   pessoa e instituição, com início e fim. A mesma pessoa pode representar a
   Universidade Alfa até março e a Startup Beta a partir de abril, sem
   duplicata e sem perder o passado.

2. **Presença é fotografia, não referência.** No check-in, a presença copia o
   vínculo, a instituição e o cargo daquele momento. Se a pessoa mudar de
   instituição amanhã, a ata da reunião passada continua correta.

3. **Indicador não se armazena, se calcula.** Todos vêm de views `vw_*`. Não
   existe coluna "total de presenças" para ficar desatualizada.
