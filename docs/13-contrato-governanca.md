# Contrato `/api/governanca` — o que o back implementa

Resposta aos documentos do front `docs/prompt-backend.md` e
`docs/contratos-complementares.md` (repositório `centro-inovacao`, commit
6ad3213, 26/10/2026). As rotas legadas (`/api/instituicoes`, `/api/reunioes`…)
continuam como estavam; o contrato novo é uma camada por cima dos mesmos casos
de uso.

Migrations 013 a 016 · código em `src/aplicacao/governanca/` · uma rota só
(`src/app/api/governanca/[...caminho]/route.js`) com a tabela em
`src/aplicacao/governanca/rotas.js` · testes em
`testes/integracao/governanca*.test.js` e `testes/banco/11-governanca.sql`.

## Regras comuns

| Regra | Como está |
|---|---|
| `versao: 1` | Em toda resposta de sucesso (`okV1`) |
| `confirmado: true` | Em toda mutação, só depois do commit (`confirmadoV1`) |
| Erros | `{ erro: { codigo, mensagem, campos? } }` — 401, 403, 404, 409, 413, 415, 422 |
| Listas | `{ versao, dados: [...] }`, conjunto autorizado completo (sem paginação), exceto auditoria (cursor) |
| Datas | Civis `AAAA-MM-DD`; horas `HH:mm`; instantes com fuso (`2026-11-01T09:00:00-03:00`). Horário local sem fuso vindo de formulário é lido em `America/Sao_Paulo` |
| Concorrência | `versaoRegistro` (coluna `versao_registro`, sobe a cada mudança real). Versão velha → **409 `VERSAO_DESATUALIZADA`** |
| Idempotência | `chaveOperacao` (UUID) em presença manual e convocação. Mesma chave + mesmo conteúdo → mesma resposta, sem duplicar; conteúdo diferente → **409 `OPERACAO_REPETIDA_DIFERENTE`** |
| Links | Absolutos. Arquivos privados saem por link assinado de 15 min (`/arquivos/:token`), porque o cookie particionado não acompanha uma aba nova |
| Papéis | Sessão continua com `admin` / `diretoria` / `representante`; `/contas` devolve os canônicos `admin_geral` / `diretoria` / `representante_instituicao` e aceita os dois |
| Sem login | Só `/publico`, `/checkin/:token`, `/qr/:token`, `/arquivos/:token` (middleware) |

## Rotas

Prefixo `/api/governanca`. ● gestão (admin + Diretoria) · A só admin · R representante (própria instituição) · P público.

| Rota | Quem | Observação |
|---|---|---|
| `GET /publico` | P | Indicadores (desconhecido = `null`), instituições e logos **autorizadas e aprovadas**, Diretoria, calendário, documentos, canais |
| `GET/PATCH /instituicoes/:id/governanca` | ●, R (GET) / PATCH só A | A Diretoria muda a ficha aprovando solicitações. Representante consultando outra instituição recebe `somenteConsulta: true`, sem titular, suplente e contatos internos |
| `GET/PATCH /representantes/:id/governanca` | ● | `:id` = pessoa. Intervalo invertido, ofício de outra instituição e conta de outra instituição são recusados; ligar conta só A |
| `GET/PATCH /reunioes/:id/governanca` | ● (GET também R) | Tipo, número, ata, convocadas (IDs), encaminhamentos em texto. `encerrada` lança as ausências |
| `GET /eventos`, `GET /eventos/:id` | ●, R | Envelope `evento` |
| `GET /eventos/configuracao` | ● | Categorias e situações |
| `POST /eventos`, `PATCH /eventos/:id` | ● | Nasce `rascunho` ou `publicada`; depois só transições válidas |
| `GET /minha-instituicao` | R (● com `?instituicaoId=`) | Ficha, participação com numerador/denominador e regra, solicitações |
| `POST /minha-instituicao/solicitacoes` | R | `alteracao_cadastral`, `correcao_presenca`, `substituicao_representante`, `encerramento_representante` — nada muda antes da aprovação |
| `GET /minha-instituicao/presencas` | R | Inclui a falta esperada (`id = esperada:<reunião>:<pessoa>`) |
| `GET /minha-instituicao/representantes` | R | Histórico de vínculos + ofícios |
| `GET /minha-instituicao/convocacoes` | R | `podeResponder` considera prazo e situação da atividade |
| `POST /minha-instituicao/convocacoes/:id/resposta` | R | Confirmar exige representante ativo; recusar exige justificativa. RSVP não é presença |
| `GET /solicitacoes` | ● | Com `resumo`, `comparacao` e `documentos` (links assinados) |
| `POST /solicitacoes/:id/decisao` | ● | `aprovar` aplica a operação do tipo na mesma transação; `rejeitar` exige parecer → `ajustes_solicitados` |
| `GET/POST /{escopo}/documentos` | ●, R (GET de outra instituição: só os visíveis a membros; POST só na própria) | escopo = `minha-instituicao`, `instituicoes/:id`, `reunioes/:id`, `eventos/:id`. PDF/PNG/JPEG ≤ 10 MB conferidos pelos bytes; logo só PNG/JPEG. Enviado pela instituição fica `em_analise` |
| `GET /arquivos/:token` | P (token) | Documento ou relatório. O RLS é conferido de novo com a conta do token |
| `GET /{reunioes\|eventos}/:id/credenciamento` | ●, R (lista só da própria) | QR, link de check-in, percentual, seletores, `registroOfflineHabilitado` |
| `POST …/credenciamento/abrir` | ● | `{ inicio, fim, permiteConvidados }` local. Gera token novo (o QR antigo para de valer) |
| `POST …/credenciamento/encerrar` | ● | |
| `POST …/presencas` | ● | Justificativa obrigatória. Convidado e equipe não contam para instituição |
| `GET /qr/:token` | P | PNG 512×512 |
| `GET/POST /checkin/:token` | P ou sessão | Identidade vem da sessão; visitante é sempre convidado; assinatura digitada obrigatória; repetido → 409 |
| `GET …/organizacao` | ●, R | Convocações (R vê só a da instituição) e encaminhamentos |
| `POST …/convocacoes` | ● | Registrada antes do e-mail; entrega gravada (`enviada`/`falhou`) |
| `POST/PATCH …/encaminhamentos[/:eid]` | ● | Responsável e prazo obrigatórios; concluir/cancelar exige resultado; fechado não reabre |
| `POST /{minha-instituicao\|reunioes/:id\|eventos/:id}/relatorios` | R (própria), ● | `{ inicio, fim, formato: xlsx\|pdf }` → `downloadUrl`. Arquivo real, guardado 1 h, só para quem gerou |
| `GET/POST/PATCH /contas[/:id]` | A | Nunca deixa o sistema sem admin ativo; convite por e-mail depois do commit |
| `GET /notificacoes`, `POST /notificacoes/:id/lida`, `PATCH /notificacoes/preferencias` | logado | Só as próprias; `destino` é sempre rota interna |
| `GET /auditoria` | ● | Filtros `inicio`, `fim` (dias inteiros em Brasília), `recurso`, `autor`; `cursor`/`limite`. Sem senha, hash, token, CPF ou conteúdo de arquivo |
| `GET/POST /instituicoes/:id/observacoes` | ● | Só acrescenta; nunca sai para representante nem público |
| `GET /importacoes`, `POST /importacoes/validar`, `POST /importacoes/confirmar` | A | CSV UTF-8 com `;`, ≤ 5 MB. Prévia de 30 min da própria conta; confirmar revalida e grava tudo ou nada; repetir devolve a mesma importação |

## Decisões que o front precisa saber

1. **Regra do percentual** (dashboard, área da instituição, relatórios): a
   instituição conta no máximo uma vez por atividade encerrada que entra no
   percentual oficial (`contaParticipacao`), entre as que ocorreram com vínculo
   vigente na data. Denominador zero → `null`. Convidados e equipe não contam.
   A resposta traz `numerador`, `denominador` e `regra`. **Validar com o Fórum.**
2. **Titular/suplente por nome** na ficha da instituição são aplicados na
   aprovação: pessoa da própria instituição com o mesmo nome, ou pessoa nova.
   Para substituir sem ambiguidade, use `substituicao_representante` (com
   e-mail do novo representante).
3. **E-mail sem provedor**: a convocação aparece como `falhou` com o motivo
   ("Nenhum provedor de e-mail configurado"). Configure `EMAIL_PROVEDOR=resend`.
   `entregue` exige confirmação do provedor (webhook) — ainda não implementado,
   então o máximo é `enviada`.
4. **Logo da instituição**: limite de 2 MB (as demais imagens e PDFs, 10 MB).
5. **Relatório de atividade**: o período informado precisa incluir a data da
   atividade.

## Variáveis de ambiente novas

| Variável | Obrigatória | Para quê |
|---|---|---|
| `SEGREDO_LINKS` | **Sim, em produção** | Assina os links de download. Sem ela, cada reinício invalida os links |
| `URL_API` | Recomendada | Endereço público da API nos links (QR, arquivos). Sem ela, usa o host da requisição |
| `EMAIL_PROVEDOR`, `RESEND_API_KEY`, `EMAIL_REMETENTE` | Para e-mail real | Convocações, convites, recuperação de senha |

## Como homologar

```bash
npm install                 # entram exceljs, pdfkit e qrcode
npm run db:migrar           # 013 a 016 (a 013 roda sem transação, de propósito)
npm run db:testar           # 127 testes SQL
npm test                    # domínio + integração (186)
```

Roteiro manual mínimo, no domínio real da Vercel: painel público sem login;
login de representante → Minha instituição → pedir alteração → aprovar com a
Diretoria; abrir credenciamento → ler o QR no celular → check-in logado e como
convidado; gerar relatório xlsx e pdf; convocar uma instituição e responder.

## Fora desta entrega

- Webhook do provedor de e-mail (status `entregue`).
- Fila de envio assíncrona (o envio é feito logo após o commit, na própria requisição).
- OpenAPI formal: esta tabela e os testes são a especificação por enquanto.
