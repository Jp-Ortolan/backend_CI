# Replanejamento — de 07/09 até a entrega em 30/09

**07/09/2026 · para a reunião de quinta, 10/09**

## Onde estamos de verdade

O cronograma original previa que hoje, 07/09, a Sprint 2 estivesse fechada e a
Sprint 3 começando. A situação real:

| Trilha | Onde deveria estar | Onde está |
|---|---|---|
| UX/UI | Sprint 3 | **Adiantada** — telas de instituição, dashboard e login prontas |
| Front-end | Sprint 3 | **Adiantado** — telas montadas na web |
| Back-end | Sprint 3 | **Fim da Semana 2** — banco e autenticação prontos, CRUD não |
| DevOps | Sprint 3 | **Semana 1** — repositório não subiu, Railway não existe |
| QA | Sprint 3 | Parado, sem ambiente onde testar |

O banco está bem: 54 testes passando, autenticação própria funcionando, migration
002 aplicada e testada. O que não existe é a camada de API entre esse banco e as
telas que o front já construiu.

**O gargalo não é o back-end. É o DevOps.** O repositório não foi para o GitHub e
os projetos do Railway não foram criados — pendência de 20/08, parada há 18 dias.
Sem isso o QA não tem onde testar, o front não tem contra o que integrar, e o
back-end publica em lugar nenhum. Enquanto isso não destravar, qualquer
replanejamento é ficção.

## Quanto tempo sobra

De hoje até 30/09 são 23 dias corridos e **17 dias úteis** — hoje é feriado.
Restam **3 reuniões**: 10/09, 17/09 e 24/09.

Não cabe o escopo original. O que segue já vem com o corte feito.

---

## O plano

### Bloco A — 08 a 10/09 · destravar e entregar instituições
**3 dias · reunião dia 10**

| Trilha | Entregar |
|---|---|
| DevOps | **Terça, 08/09, sem passar disso:** repositório no GitHub, `main` e `develop` protegidas, projeto Railway de homologação de pé, secrets cadastrados |
| Back-end | Aplicar 001 + 002 em homologação · CRUD completo de instituição, com os campos novos · busca, filtro e paginação no servidor |
| Front-end | Ligar as telas de instituição na API de verdade, tirando o mock |
| QA | Subir homologação e rodar CT01 a CT06 (login e recuperação de senha) |
| UX/UI | Enviar as telas que faltam: representantes, reuniões e presenças |

**Na reunião de 10/09:** cadastro de instituição funcionando ponta a ponta, com
dado de verdade em homologação. É a primeira demonstração real do sistema.

### Bloco B — 11 a 17/09 · pessoas, vínculos e reuniões
**5 dias · reunião dia 17**

| Trilha | Entregar |
|---|---|
| Back-end | CRUD de pessoa · vínculo com encerramento preservando histórico · CRUD de reunião · convite e confirmação |
| Front-end | Telas de representante, vínculo e reunião ligadas na API |
| DevOps | Deploy automático de `develop` em homologação a cada merge |
| QA | Casos de CRUD, vínculo e validação de campo |

**Na reunião de 17/09:** cadastro completo — instituição, representante, vínculo
e reunião — em homologação.

### Bloco C — 18 a 24/09 · check-in, dashboard e histórico
**5 dias · code freeze dia 24 · reunião dia 24**

| Trilha | Entregar |
|---|---|
| Back-end | Rotas de check-in publicadas (a lógica já está pronta no banco) · APIs de dashboard e histórico sobre as views · documentos |
| Front-end | Página pública de check-in mobile · dashboard com os gráficos · histórico |
| QA | **QR Code em celular de verdade** — é o teste que não dá para simular · indicadores conferidos na mão |
| DevOps | Ambiente de produção preparado, ainda sem publicar |

**Sexta, 24/09, é o code freeze.** Depois disso só entra correção de defeito.

### Bloco D — 25 a 30/09 · fechar
**4 dias · entrega dia 30**

Correção dos defeitos da homologação, deploy em produção, manual do usuário,
manual técnico, documentação das APIs, vídeo de demonstração e slides.

**Nada de funcionalidade nova aqui.** Esses 4 dias são a margem que faz a entrega
acontecer no dia 30 em vez de na madrugada do dia 30.

---

## O que está sendo cortado

Corte explícito é melhor do que descobrir na última semana que não coube:

1. **Importação das planilhas do Drive** — some do escopo. O sistema entra com
   cadastro manual; a importação vira melhoria posterior.
2. **Backup automático e monitoramento sob medida** — usar o que o Railway já
   oferece e documentar o procedimento. Construir os dois custaria dias.
3. **Teste de carga no check-in simultâneo** — cortado. Testar com celular de
   verdade, feito com atenção, vale mais para esta entrega.
4. **Notificações** — o banco está pronto, a tela lista o que existir. Sem envio
   por e-mail e sem gatilho automático.
5. **Envio de e-mail na recuperação de senha** — precisa de provedor (Resend
   resolve em cerca de uma hora). Se não entrar, o link é gerado e entregue pelo
   administrador, e isso fica escrito no manual.
6. **Upload de documentos** — é o primeiro candidato a cair se o Bloco C
   apertar, porque depende de um serviço de armazenamento que ainda não existe.
   Alternativa barata: guardar link externo em vez de arquivo.

## Os riscos, em ordem

1. **DevOps parado.** Se GitHub e Railway não estiverem de pé até quarta, 09/09,
   nada abaixo se sustenta e o plano precisa ser refeito na reunião do dia 10.
2. **Integração acontecendo tarde.** O plano original juntava front e back só na
   Semana 6. Aqui a integração é contínua, um bloco por vez — descobrir
   incompatibilidade no dia 25 seria fatal.
3. **Telas que faltam.** Representantes, reuniões e presenças não chegaram. Sem
   elas até 10/09, o Bloco B começa no escuro.
4. **Back-end concentrado numa pessoa.** O cronograma previa duas. Se for uma,
   os Blocos B e C ficam apertados e o corte do item 6 acima passa de opção a
   decisão.

## O que precisa sair decidido da reunião de 10/09

- Quem assume o DevOps hoje, com nome e prazo
- As telas que faltam têm data?
- O corte dos 6 itens acima está aceito?
- Documentos: arquivo de verdade ou link externo?
- O código congela mesmo no dia 24?
