# Revisão de outubro/2026 — o que era do back-end e o que foi feito

Resposta ao documento de revisão do Fórum ("Os perfis ainda não estão de acordo
com o necessário..."). Cada item foi separado em **back-end** (regra, dado,
permissão, rota — feito nesta entrega) e **front-end** (tela que consome a rota —
fica para o front). Migrations 007 a 011; testes em
`testes/banco/10-perfis-forum.sql` e `testes/integracao/forum.test.js`.

---

## 1. "Os três usuários enxergam os mesmos menus"

**Causa no back:** o menu era derivado de "o perfil pode VER o recurso?". Como
admin, gestor e leitura podiam ver tudo, os três recebiam os mesmos itens. E no
banco a leitura também era igual para todos: "qualquer autenticado lê tudo".

**Feito no back**
- Perfis do Fórum: `admin`, `diretoria` (era `gestor`), `representante` (era
  `leitura`), e o público sem login. Renomeados no enum, sem perder dado.
- A conta do representante pertence a uma instituição (`usuario.instituicao_id`)
  e, opcionalmente, a uma pessoa do cadastro (`usuario.pessoa_id`).
- Menu escrito por perfil; a sessão devolve também a matriz `permissoes`, o
  `escopo` e a `instituicao`.
- RLS recortando pessoa, vínculo, presença, convite, documento, solicitação e
  auditoria pela instituição do representante; guardas no banco para o que ele
  não pode mudar (nome, CNPJ, situação, papel da própria conta).
- Gestão de contas pelo admin (`/api/usuarios`), com link de primeiro acesso.

**Fica para o front:** ler `menu` e `permissoes` de `/api/sessao` (o `App.jsx`
hoje só desenha os itens que têm ícone em `ICONES` — por isso Documentos e
Usuários nunca apareciam); criar as telas `/minha-instituicao`, `/eventos`,
`/solicitacoes`, `/usuarios`, `/relatorios`, `/configuracoes`; esconder botões a
partir de `permissoes`.

## 2. "Não existe dashboard público"

**Causa:** o redirecionamento para o login é do front, mas o back também não
tinha de onde servir dado sem login — o RLS devolve zero linhas sem usuário.

**Feito no back:** rotas `/api/publico/*` (liberadas no middleware, com limite
por IP), servidas por funções do banco que só devolvem o que pode ser público:
indicadores agregados, instituições que **autorizaram** a divulgação (com logo,
se autorizada), filtros por tipo/vertente/área, composição da Diretoria
(cargo no Fórum), agenda pública, documentos públicos, links oficiais e de
manifestação de interesse (configuráveis pelo admin).

**Fica para o front:** a rota `/dashboard` (ou `/`) acessível sem login,
consumindo `/api/publico`.

## 3. "Eventos ainda não existem como módulo"

**Feito no back:** reunião e evento são registros diferentes (`natureza`), na
mesma tabela — é o que deixa presença, convite, QR e lista funcionarem igual
para os dois, como a revisão pede. Rotas separadas `/api/reunioes` e
`/api/eventos`. Tipos cadastráveis (ordinária, extraordinária, diretoria, GT,
workshop, missão técnica, palestra, evento parceiro, calendário unificado).
Campos: número ("68ª"), modalidade, responsável, público-alvo, limite,
rascunho/publicada, link de inscrição, organização, próprio ou parceiro,
exibir no calendário público, participantes externos, GT, encaminhamentos com
responsável e prazo, e **"conta ou não para o percentual oficial"** — evento e
reunião de GT não derrubam mais o percentual de todas as instituições.

**Fica para o front:** telas de evento e os campos novos no formulário.

## 4. "Presenças e QR Code ainda não estão implementados"

O back já tinha QR, check-in, marcação manual e lista desde setembro; faltava a
tela. Nesta entrega o back ganhou o que a revisão listou e não existia:

| Pedido | Rota / regra |
|---|---|
| Abertura e encerramento do credenciamento | `POST /api/reunioes/:id/credenciamento` (`abrir`, `fechar`, `novo_qr`) |
| QR válido só durante a atividade | Janela de check-in + "novo QR" invalida o anterior; rascunho não aceita |
| Se logado, dados automáticos | `GET /api/checkin/:token` devolve `voce`; `POST { proprio: true }` usa a pessoa da sessão |
| Representante, convidado e equipe | `tipo` ganhou `equipe`; convidado pode ser desligado por atividade |
| Presencial ou on-line | `modo` na presença |
| Impedir duplicada | Já existia (unicidade + "já registrado" é sucesso) |
| Correção manual e quem corrigiu | `registrado_por` + auditoria; aparece como `registradoPor` na lista |
| Justificativa de ausência | `status = justificado` + observação; o representante pede por solicitação |
| Assinatura eletrônica simples | `assinar: true` grava hora e IP |
| Limite de participantes | `LIMITE_ATINGIDO` no check-in |
| Lista em Excel | `?formato=csv` (o PDF segue no front, a partir do JSON) |
| Percentual de participação | Regra única: `GET /api/relatorios/participacao` |

**Fica para o front:** desenhar o QR a partir de `checkin.url`, botões de
abrir/fechar, lista com filtros, inclusão/correção manual, exportação.

## 5. Cadastro de instituições, área da instituição e representantes

**Feito no back**
- Campos: razão social, nome fantasia, vertente, GTs, redes sociais, contatos de
  comunicação, logo, autorização de divulgação (da instituição e da logo),
  motivo de saída e instituição substituta. "Data de ingresso" é a
  `data_entrada` (gravada na aprovação); "observações internas" é a
  `observacoes` (nunca sai para outra instituição); ofício e termo de adesão
  são documentos com `tipo`; histórico é a auditoria + histórico de situação.
- Situação: rascunho → aguardando documentos → em análise → ajustes
  solicitados → aprovada/ativa → inativa / desligada, com transições
  conferidas e `pendencias` (o que falta para enviar para análise).
- Área da instituição (`/api/minha-instituicao`): o representante atualiza
  contato, endereço, redes e logo direto; consulta documentos, reuniões e
  eventos em que participou e o percentual; baixa relatório próprio.
- Solicitações com aprovação para o que é sensível: troca de titular e de
  suplente, inclusão e exclusão de representante, nome/CNPJ, novo ofício,
  entrada e saída do Fórum, correção de presença. Aprovar aplica a mudança na
  mesma transação; o representante é avisado no sino.
- Representante: titular / suplente / integrante / convidado (um titular e um
  suplente vigentes por instituição — garantido no banco), cargo no Fórum,
  motivo do encerramento, ofício que formalizou, GTs, autorização para
  comunicações, usuário vinculado.

**Fica para o front:** os campos novos nos formulários, a área da instituição,
a fila de solicitações da Diretoria.

## 6. Governança e segurança

| Pedido | Situação |
|---|---|
| Auditoria (quem e quando) | Já existia; agora também em solicitação e encaminhamento, e legível pela Diretoria |
| Inativação em vez de exclusão | Já existia; Diretoria não exclui; conta de usuário não tem DELETE |
| Confirmação antes de excluir | Front (o back já recusa exclusão com histórico) |
| Documentos por versão | `versao` + `substitui_id`; a lista pública mostra só a vigente |
| LGPD | Painel público sem dado pessoal; autorização de divulgação e de comunicação; listas nominais só da própria instituição |
| Regra única dos indicadores | `conta_participacao` + uma só fórmula (views e relatório) |
| Backup | Já existia (`docs/09-operacao.md`) |

## 7. "Correção da sessão"

**Causa provável:** o front publicado (Vercel) e a API (Railway) estão em
domínios diferentes. O cookie de sessão só volta nesse cenário se for gravado
com `SameSite=None; Secure` — e isso dependia da variável `COOKIE_CROSS_SITE=1`
no Railway. Sem ela, o login dava certo, mas a chamada seguinte voltava 401 e o
front mandava de volta para o login.

**Feito no back:** a API detecta sozinha a requisição vinda de outro domínio
HTTPS e grava o cookie `SameSite=None; Secure; Partitioned` (Partitioned é o que
o Chrome exige com o bloqueio de cookies de terceiros). O logout apaga o cookie
com os mesmos atributos. E a sessão passou a ser renovada enquanto a pessoa usa
o sistema (antes caía em 12 h fixas, mesmo no meio de uma reunião).

**Recomendado (DevOps/front):** o Safari bloqueia cookie de terceiro mesmo com
`SameSite=None`. O jeito definitivo é o front chamar a API pelo próprio domínio,
com um rewrite no `vercel.json` do front:

```json
{ "source": "/api/:caminho*", "destination": "https://backendci-production.up.railway.app/api/:caminho*" }
```

(antes da regra que manda tudo para `index.html`), e `VITE_API_URL` vazio.

---

## Antes de aplicar em produção

1. `npm run db:migrar` aplica 007 a 011. A 007 não tem transação de propósito
   (valor novo de enum só pode ser usado depois de confirmado).
2. Contas "leitura" viraram **representante sem instituição**: o admin liga cada
   uma à instituição (`PATCH /api/usuarios/:id`) ou muda o perfil.
3. Instituições que estavam "em processo de entrada" agora estão `em_analise`.
4. Vertentes e GTs nascem vazios — a Diretoria cadastra pelos nomes do Fórum
   (`POST /api/dominios`).
5. Todas as reuniões existentes continuam contando no percentual
   (`conta_participacao = true`). Revisar as que eram reunião de GT ou de diretoria.
6. Publicar no front os valores novos de `papel` e de `status` (tabela no fim do
   contrato de API).

---

## Atualização de 26/10 — contrato `/api/governanca`

O front passou a consumir um contrato próprio (`/api/governanca`, versão 1).
Tudo o que ele pede foi implementado nas branches
`feature/governanca-cadastros`, `feature/governanca-atividades` e
`feature/relatorios-e-importacao` (migrations 013 a 016). Rotas, regras e
roteiro de homologação: [13-contrato-governanca.md](13-contrato-governanca.md).
