# Contrato de API — trilha Back-end

O front-end precisa disso definido antes de começar as telas. Enquanto as rotas
não existem, ele trabalha com mock em cima destes formatos.

Toda leitura e escrita passa por `comUsuario(...)` — a transação que declara
quem é o usuário para o RLS.

> **Atualizado em 07/09/2026.** O plano original era o front consumir os dados
> por Server Component e Server Action, com Route Handler só onde houvesse regra
> fora da policy. As telas foram montadas consumindo HTTP, então a Sprint 1
> entregou rotas REST para cadastro e indicadores — estão no fim deste
> documento. A regra de segurança não mudou: toda rota abre a transação com o
> usuário declarado e o RLS continua decidindo o que cada perfil enxerga.

> **Atualizado em 10/09/2026.** O projeto passou a ser só back-end: as telas
> saíram de `src/app/` e o login virou rota de API. O que mudou está na última
> seção, "Autenticação e CORS".

## Convenções

- Datas em ISO 8601. `timestamptz` sempre em UTC; a formatação é do front.
- Erro no formato `{ "erro": { "codigo": "...", "mensagem": "..." } }`.
- Paginação por `?pagina=1&porPagina=20`; resposta traz `{ dados, total, pagina }`.
- `codigo` é estável e serve para o front decidir o que mostrar; `mensagem` é
  texto em português e pode mudar.

## Direto por consulta (sem rota própria)

| Operação | Consulta | Requisito |
|---|---|---|
| Listar instituições com filtro | `select ... from instituicao where status = $1` | RF11, RF12 |
| Detalhe da instituição | `instituicao` + `vinculo` + `pessoa` + `documento` | RF08 |
| Criar / editar instituição | `insert` / `update` | RF06, RF07 |
| Listar reuniões | `select ... from reuniao` | RF24 |
| Indicadores | `select * from vw_dashboard` | RF46 |
| Histórico por representante | `select * from vw_participacao_representante` | RF41 |

Tudo dentro de `comUsuario(usuario.id, tx => ...)`. O RLS garante que só admin e
gestor escrevem — esconder um botão no front é conforto, não segurança.

---

## `POST /api/vinculos/:id/encerrar` — RF16

Encerrar vínculo é mais do que um update: precisa preservar histórico e liberar
a pessoa para um novo vínculo.

```json
// requisição
{ "dataFim": "2026-08-31", "observacoes": "Saiu da instituição" }

// 200
{ "id": "uuid", "status": "encerrado", "dataFim": "2026-08-31" }
```

| Código | Situação |
|---|---|
| `VINCULO_JA_ENCERRADO` | 409 |
| `DATA_FIM_ANTERIOR_AO_INICIO` | 422 |

---

## `GET /api/checkin/:qrToken` — RF27

Dados públicos da reunião para montar a tela. **Não expõe** lista de participantes.

```json
// 200
{
  "reuniao": { "titulo": "Reunião Ordinária — Setembro", "data": "2026-09-18",
               "horaInicio": "09:00", "local": "Auditório" },
  "checkinAberto": true
}
```

| Código | Situação |
|---|---|
| `REUNIAO_NAO_ENCONTRADA` | 404 — token inválido |
| `CHECKIN_FECHADO` | 403 — fora da janela (RNF13) |
| `REUNIAO_CANCELADA` | 410 |

---

## `GET /api/checkin/:qrToken/buscar?nome=...` — RF28

Busca por trigram sobre `pessoa.nome_busca`. Mínimo de 3 caracteres.

```json
// 200 — no máximo 5 resultados
{ "resultados": [
  { "pessoaId": "uuid", "nome": "José da Silva Júnior",
    "instituicao": "Startup Beta", "cargo": "CTO", "vinculoId": "uuid" }
] }
```

Devolve apenas pessoas com **vínculo ativo**. Sem correspondência, `resultados: []`
— e a tela oferece o caminho de convidado (RF32).

Retornar nome e instituição de quem não confirmou presença é uma exposição
pequena mas real. Limitar a 5 resultados e exigir 3 caracteres reduz a chance de
alguém varrer a base pelo endpoint. Vale rever com o Centro de Inovação.

---

## `POST /api/checkin/:qrToken` — RF29 a RF34

O endpoint central do sistema. Roda no servidor com service role.

```json
// representante identificado
{ "pessoaId": "uuid", "vinculoId": "uuid" }

// convidado (RF32)
{ "convidado": { "nome": "Patrícia Nogueira",
                 "email": "patricia@empresa.com.br",
                 "instituicao": "Empresa X" } }
```

```json
// 201
{ "presencaId": "uuid", "nome": "José da Silva Júnior",
  "instituicao": "Startup Beta", "tipo": "representante",
  "horarioCheckin": "2026-09-18T12:04:11Z" }
```

Passos obrigatórios no servidor, nesta ordem:

1. Resolver o `qr_token` → reunião. Não existe: 404.
2. Conferir a janela de check-in e o status da reunião. Fora: 403.
3. Aplicar limite por IP (RNF14).
4. Se representante: buscar o **vínculo ativo na data da reunião** e gravar
   `vinculo_id`, `instituicao_id` e `cargo_no_momento` como snapshot (RF31).
5. Se convidado: gravar `tipo = 'convidado'`, sem `vinculo_id` (RF33).
6. Gravar `horario_checkin = now()` (RF30).

| Código | Situação |
|---|---|
| `PRESENCA_JA_REGISTRADA` | 409 — RF34 |
| `CHECKIN_FECHADO` | 403 |
| `VINCULO_INVALIDO` | 422 — vínculo não pertence à pessoa ou está encerrado |
| `MUITAS_TENTATIVAS` | 429 |

`PRESENCA_JA_REGISTRADA` não é erro para o participante: a tela deve dizer
"sua presença já estava registrada às 09:02" e mostrar sucesso. Ele fez a coisa
certa duas vezes; não pode parecer que falhou.

---

## `POST /api/reunioes/:id/encerrar` — RF39

Encerra a reunião e marca como ausente quem tinha vínculo ativo na data e não
registrou presença. É o que fecha o denominador dos indicadores.

```json
// 200
{ "status": "encerrada", "presentes": 12, "ausentesMarcados": 5, "convidados": 2 }
```

---

## Ordem sugerida de implementação

| Semana | Entregar | Situação |
|---|---|---|
| 2 (20–26/08) | Migrations, RLS, autenticação | **feito** |
| 3 (27/08–02/09) | CRUD de instituição, representante e vínculo + `POST /api/vinculos/:id/encerrar` | **feito em 07/09**, com atraso |
| 4 (03–09/09) | As três rotas de `/api/checkin` + `POST /api/reunioes/:id/encerrar` | **feito** (adiantado na Semana 2) |
| 5 (10–16/09) | CRUD de reunião, convites e histórico por representante | **feito em 07/09** (Bloco B) |
| 5 (10–16/09) | Upload de documentos | **feito em 07/09** (Bloco C) |

Cronograma real das semanas restantes em
[08-replanejamento-setembro.md](08-replanejamento-setembro.md).

---

# Rotas da Sprint 1 — cadastro (entregues em 07/09)

As telas de instituição e o dashboard consomem HTTP direto. Todas exigem sessão,
todas passam por `comUsuario(...)` e o RLS decide o que cada perfil enxerga.

Corpo em camelCase; o banco é snake_case e a tradução fica em
`src/aplicacao/instituicoes/esquemas.js`.

## `GET /api/dominios`

Abastece os selects do formulário. Chame uma vez ao abrir a tela.

```json
{
  "tiposInstituicao": [{ "id": 1, "nome": "Universidade", "ativo": true }],
  "areasAtuacao":     [{ "id": 3, "nome": "Educação", "ativo": true }],
  "statusInstituicao":[{ "valor": "ativa", "rotulo": "Ativa" }]
}
```

Só o que está `ativo` aparece. `?incluirInativos=true` traz o resto, para a tela
de detalhe conseguir exibir o rótulo de uma opção já desativada.

## `GET /api/instituicoes` — RF11, RF12

Parâmetros: `busca`, `status`, `tipoInstituicaoId`, `areaAtuacaoId`, `cidade`,
`uf`, `ordenarPor` (`nome|cidade|status|criado`), `ordem` (`asc|desc`),
`pagina`, `porPagina` (máximo 100).

```json
{
  "dados": [{
    "id": "uuid", "nome": "Universidade Nova", "cnpj": "12345678000181",
    "email": "contato@uninova.edu.br", "tipo": "Universidade",
    "area": "Educação", "cidade": "Guarapuava", "uf": "PR",
    "status": "ativa", "representantesAtivos": 27
  }],
  "total": 122, "pagina": 1, "porPagina": 20, "paginas": 7
}
```

O campo `busca` procura por nome **ou** CNPJ, e decide qual pela ausência de
letra: só dígitos e a pontuação `./-` viram busca de CNPJ por prefixo; qualquer
letra vira busca de nome, sem acento e por trecho. É o que faz "Colégio 31 de
Março" ser encontrado pelo nome em vez de ir parar na coluna de CNPJ.

`total` e `paginas` alimentam o rodapé "Mostrando 1 a 9 de 122 instituições".

## `POST /api/instituicoes` — RF06, RF13

Corpo com os campos do formulário. Obrigatórios, os mesmos que a tela marca com
asterisco: `nome`, `cnpj`, `dataFundacao`, `status`, `telefone`, `logradouro`,
`bairro`, `cidade`, `estado`, `cep`, `tipoInstituicaoId`, `areaAtuacaoId`.

```json
{
  "nome": "Universidade Nova", "cnpj": "12.345.678/0001-81",
  "dataFundacao": "1998-03-15", "status": "ativa",
  "email": "contato@uninova.edu.br", "telefone": "(42) 3633-3333",
  "site": "www.uninova.com.br",
  "logradouro": "Rua das Chaves", "numero": "123", "bairro": "Centro",
  "cidade": "Guarapuava", "estado": "PR", "cep": "80000-000",
  "complemento": "Bloco A - Reitoria",
  "tipoInstituicaoId": 1, "areaAtuacaoId": 3,
  "descricao": "Até 500 caracteres."
}
```

`201` devolve `{ "id", "nome", "status" }`.

CNPJ e CEP podem vir com máscara: o servidor guarda só os dígitos. Se a máscara
fosse gravada, "12.345.678/0001-81" e "12345678000181" pareceriam CNPJs
diferentes e a restrição de unicidade deixaria os dois entrarem.

O CNPJ tem o **dígito verificador conferido** — o banco só garante que são 14
dígitos, então `11111111111111` passaria por ele e é recusado aqui.

## `GET /api/instituicoes/:id` — RF08

Devolve a tela de detalhe inteira numa resposta: `endereco`, `classificacao`,
`representantes` (a aba), `documentos`, `participacao` e `cadastro`.

```json
{
  "id": "uuid", "nome": "Universidade Nova",
  "cnpj": "12345678000181", "cnpjFormatado": "12.345.678/0001-81",
  "endereco": { "logradouro": "...", "cep": "80000000", "estado": "PR" },
  "classificacao": { "tipo": "Universidade", "area": "Educação", "descricao": "..." },
  "representantes": [{ "vinculoId": "uuid", "nome": "...", "cargo": "...", "status": "ativo" }],
  "totalRepresentantes": 27, "representantesAtivos": 27,
  "documentos": [{ "id": "uuid", "nome": "Relatório", "tamanhoBytes": 1258291 }],
  "participacao": {
    "participacoesTotais": 123, "reunioesParticipadas": 29,
    "mediaPresenca": "65.0", "ultimaParticipacao": "2026-08-25T12:04:11Z"
  },
  "cadastro": {
    "criadoEm": "2025-04-22T09:54:00Z", "criadoPor": "Administrador Kauan",
    "atualizadoEm": "2026-07-17T16:02:00Z", "atualizadoPor": "Administrador Rafael"
  }
}
```

`participacao.mediaPresenca` vem **null**, não `0`, quando a instituição ainda
não teve reunião esperada. A tela deve mostrar "—": anunciar 0% faria parecer
que ela nunca comparece, quando o que houve foi nunca ter sido chamada.

`cadastro.criadoPor` sai da view `vw_usuario_publico`. A tabela `usuario` esconde
a linha de outro usuário até de um gestor, e sem a view o card "Informações do
cadastro" apareceria vazio para quem não é administrador.

## `PATCH /api/instituicoes/:id` — RF07

Aceita o formulário inteiro ou só os campos alterados; o que não vier não é
tocado. Corpo vazio é recusado com `DADOS_INVALIDOS` em vez de responder sucesso
sem ter salvado nada.

## `POST /api/instituicoes/:id/status` — RF09, RF10

É o botão "Desativar instituição", e o caminho certo quando a exclusão é
bloqueada.

```json
{ "status": "inativa", "dataSaida": "2026-09-07", "motivo": "Saiu do ecossistema" }
```

`dataSaida` é opcional ao desativar — sem ela o servidor usa hoje. Ao reativar, a
data de saída é limpa: instituição ativa com data de saída preenchida faria a
listagem mentir sobre quem ainda está no ecossistema.

A troca de situação vira linha em `instituicao_status_historico` sozinha, por
trigger. O front não precisa registrar nada.

## `DELETE /api/instituicoes/:id`

Só administrador, e só cadastro **sem histórico nenhum**.

| Código | Situação | O que a tela mostra |
|---|---|---|
| `INSTITUICAO_COM_HISTORICO` | 409 — já tem presenças | "Já participou de reuniões e não pode ser excluída. Você pode desativá-la." |
| `INSTITUICAO_COM_VINCULO` | 409 — tem representantes | "Encerre os vínculos antes de excluir, ou desative a instituição." |
| `SEM_PERMISSAO` | 403 — perfil não é admin | |

Nos dois primeiros o erro traz `extra.acaoSugerida: "desativar"`, para a tela
poder oferecer o botão certo no próprio aviso em vez de deixar o usuário
adivinhar o que fazer.

## `GET /api/representantes` — RF14, RF17

Parâmetros: `busca` (nome ou e-mail), `instituicaoId`, `vinculo`
(`ativo|encerrado|todos`), `pagina`, `porPagina`.

Devolve a **pessoa** com os vínculos dela dentro, e não uma linha por vínculo —
é o que faz a tela mostrar "José da Silva — Startup Beta (atual), Universidade
Alfa (até 05/2025)" em vez de dois Josés soltos.

```json
{ "dados": [{
    "id": "uuid", "nome": "José da Silva Júnior", "email": "jose@alfa.br",
    "vinculos": [{ "vinculoId": "uuid", "instituicao": "Startup Beta",
                   "cargo": "CTO", "status": "ativo", "dataInicio": "2025-06-01" }],
    "vinculoAtual": { "instituicao": "Startup Beta", "cargo": "CTO" }
}], "total": 126 }
```

## `POST /api/representantes` — RF14, RF15

Cria a pessoa e o vínculo numa transação só.

```json
{ "nome": "Maria Souza", "email": "maria@uninova.edu.br",
  "telefone": "(42) 98888-0000",
  "vinculo": { "instituicaoId": "uuid", "cargo": "Pró-reitora",
               "dataInicio": "2026-09-01" } }
```

Se já existir pessoa com aquele **e-mail**, o vínculo novo é criado sobre ela em
vez de duplicá-la — é o caso de quem troca de instituição, e é o que preserva o
histórico anterior. Sem e-mail não dá para afirmar que é a mesma pessoa (dois
"João Silva" podem ser dois Joões), então aí uma nova é criada.

## `POST /api/vinculos` — RF15

Vincula uma pessoa **já cadastrada** a outra instituição.

```json
{ "pessoaId": "uuid", "instituicaoId": "uuid", "cargo": "Diretora" }
```

O vínculo anterior **não** é encerrado automaticamente: representar duas
instituições ao mesmo tempo é legítimo, e adivinhar que o anterior acabou
apagaria período de participação sem ninguém ter pedido. Quem saiu usa
`POST /api/vinculos/:id/encerrar`.

`VINCULO_DUPLICADO` (409) quando a pessoa já representa aquela instituição.

## `GET /api/indicadores` — RF46

O dashboard inteiro.

```json
{
  "cartoes": {
    "instituicoes": { "ativas": 122, "inativas": 8, "emProcesso": 3 },
    "representantesAtivos": 126, "reunioesRealizadas": 41,
    "reunioesAgendadas": 4, "mediaPresenca": "88.0"
  },
  "evolucaoParticipacao": [{ "mes": "2026-07", "percentual": 88.0, "reunioes": 3 }],
  "participacaoPorInstituicao": [{ "instituicao": "Universidade", "percentual": 94.0 }],
  "proximasReunioes": [{ "titulo": "Reunião Mensal", "data": "2026-09-12",
                         "horaInicio": "13:00", "local": "Auditório",
                         "endereco": "Prefeitura de Guarapuava",
                         "convitesEnviados": 122, "confirmados": 115 }]
}
```

`mediaPresenca` é **representantes presentes ÷ vínculos vigentes na data da
reunião**, só sobre reuniões encerradas, com convidado avulso fora da conta.
Vem `null` enquanto não houver reunião encerrada — a tela mostra "—".

O ranking por instituição exclui quem tem zero reuniões esperadas: entraria como
barra vazia, sugerindo ausência onde não houve nem oportunidade de comparecer.

## Códigos de erro acrescentados na Sprint 1

| Código | HTTP | Quando |
|---|---|---|
| `NAO_ENCONTRADO` | 404 | id não existe, ou o RLS não deixou ver |
| `CNPJ_DUPLICADO` | 409 | já existe instituição com aquele CNPJ |
| `EMAIL_DUPLICADO` | 409 | já existe pessoa ou usuário com aquele e-mail |
| `VINCULO_DUPLICADO` | 409 | a pessoa já representa aquela instituição |
| `INSTITUICAO_COM_HISTORICO` | 409 | exclusão barrada por presenças registradas |
| `INSTITUICAO_COM_VINCULO` | 409 | exclusão barrada por representantes vinculados |
| `DATA_SAIDA_OBRIGATORIA` | 422 | inativar sem informar a data de saída |

`NAO_ENCONTRADO` cobre de propósito os dois casos: responder algo diferente
quando o registro existe mas está fora do alcance confirmaria a existência de um
dado que a pessoa não podia consultar.

`DADOS_INVALIDOS` passa a trazer `extra.campos` com a lista completa:

```json
{ "erro": { "codigo": "DADOS_INVALIDOS",
            "mensagem": "CNPJ inválido. Confira os números digitados.",
            "campos": [{ "campo": "cnpj", "mensagem": "CNPJ inválido..." },
                       { "campo": "bairro", "mensagem": "Informe o bairro." }] } }
```

`mensagem` é a primeira, para o aviso em destaque; `campos` permite marcar o
formulário inteiro de uma vez, em vez de o usuário descobrir um erro por
tentativa de envio.

---

# Rotas do Bloco B — reuniões, convites e histórico (entregues em 07/09)

## `GET /api/reunioes` — RF24

Parâmetros: `busca`, `status`, `periodo` (`proximas|passadas|todas`), `de`,
`ate`, `instituicaoId`, `ordem`, `pagina`, `porPagina`.

```json
{ "dados": [{
    "id": "uuid", "titulo": "Reunião Mensal do Ecossistema",
    "data": "2026-09-12", "horaInicio": "13:00",
    "local": "Auditório", "endereco": "Prefeitura de Guarapuava",
    "status": "agendada",
    "esperados": 126, "convitesEnviados": 122, "confirmados": 115,
    "presentes": 0, "ausentes": 0, "convidados": 0,
    "percentualComparecimento": null
}], "total": 41, "pagina": 1, "paginas": 3 }
```

`percentualComparecimento` vem **null** enquanto a reunião não estiver
encerrada. Antes disso o número existiria mas não significaria nada, e o gráfico
mostraria queda de participação onde só houve reunião que ainda não aconteceu.

`instituicaoId` filtra por convite **ou** presença: só convite esconderia quem
apareceu sem ser chamado, só presença esconderia quem foi chamado e faltou.

## `POST /api/reunioes` — RF23

```json
{ "titulo": "Reunião Mensal", "descricao": "Reunião geral",
  "data": "2026-09-12", "horaInicio": "13:00", "horaFim": "15:00",
  "local": "Auditório", "endereco": "Prefeitura de Guarapuava",
  "checkinAbreEm": "2026-09-12T15:30:00Z",
  "checkinFechaEm": "2026-09-12T18:30:00Z",
  "convidarTodos": true }
```

`201` devolve `{ "id", "titulo", "data", "status", "convidados" }`.

`convidarTodos` convida todos os vínculos ativos de instituições ativas na mesma
transação — com 122 instituições, convidar na mão não é opção. Se a criação
falhar, nenhum convite fica pendurado.

A janela de check-in é opcional. Sem ela vale o dia inteiro da reunião, para uma
reunião cadastrada às pressas não nascer com o QR travado.

O `qr_token` não é informado nem escolhido: o banco gera 16 bytes aleatórios.
Fosse derivado do id, quem conhecesse uma URL adivinharia as outras.

## `GET /api/reunioes/:id` — RF25

Além dos dados da reunião, devolve `resumo`, `participantes` e o bloco
`checkin`:

```json
{ "checkin": {
    "token": "a1b2...", "url": "https://.../checkin/a1b2...",
    "abreEm": null, "fechaEm": null, "janelaPadrao": true },
  "resumo": { "esperados": 126, "convitesEnviados": 122, "confirmados": 115,
              "presentes": 0, "ausentes": 0, "convidados": 0,
              "percentualComparecimento": null },
  "participantes": [{
    "conviteId": "uuid", "presencaId": null,
    "nome": "José da Silva", "instituicao": "Startup Beta", "cargo": "CTO",
    "tipo": "representante", "statusConfirmacao": "confirmado",
    "statusPresenca": null, "horarioCheckin": null }] }
```

`checkin.url` é montada no servidor a partir de `NEXT_PUBLIC_APP_URL`. O
endereço público muda entre homologação e produção; um valor fixo no front
geraria QR apontando para o ambiente errado.

O token só sai por esta rota, que exige sessão e permissão de ver reunião — quem
tem o token registra presença, então ele nunca vai para uma resposta pública.

## `PATCH /api/reunioes/:id`

Reunião **encerrada** não aceita mudança de `data` nem de `horaInicio`: os
indicadores já foram calculados sobre eles, e mexer agora recalcularia quem "era
esperado" e reescreveria participação passada de gente que não tem nada a ver
com a correção. Os demais campos continuam editáveis.

Reunião **cancelada** não aceita edição nenhuma até ser reaberta.

## `POST /api/reunioes/:id/status`

```json
{ "status": "cancelada", "motivo": "Sem quórum" }
```

Transições permitidas:

| De | Para |
|---|---|
| `agendada` | `em_andamento`, `cancelada` |
| `em_andamento` | `agendada`, `cancelada` |
| `cancelada` | `agendada` |
| `encerrada` | nenhuma |

Encerrada não volta atrás por aqui: as ausências já foram gravadas, e reabrir
sem desfazê-las deixaria o indicador contando gente duas vezes. O encerramento
tem endpoint próprio (`POST /api/reunioes/:id/encerrar`), porque marca os
ausentes e fecha o denominador — coisa que nenhuma outra transição faz.

Cancelar mantém a linha, os convites e o histórico. Some da agenda, não da base.

## `DELETE /api/reunioes/:id`

| Código | HTTP | Situação |
|---|---|---|
| `REUNIAO_COM_PRESENCA` | 409 | há presenças registradas |
| `REUNIAO_COM_DOCUMENTO` | 409 | há documentos anexados |

Os dois trazem `extra.acaoSugerida: "cancelar"`.

**Convite não impede a exclusão; presença impede.** Convite é intenção, não
fato: uma reunião marcada errado, com convites já disparados, pode ser apagada.
O que não pode sumir é quem esteve lá.

Este endpoint é o que tem a proteção mais importante do sistema:
`presenca.reuniao_id` é `on delete cascade`, então sem a trigger da migration
003 um `DELETE` apagaria todas as presenças da reunião **sem erro nenhum**, e o
indicador de participação mudaria sem ninguém saber por quê.

## `POST /api/reunioes/:id/convites`

Corpo vazio convida todos os vínculos ativos de instituições ativas. Com
`vinculoIds` convida só os escolhidos.

```json
{ "vinculoIds": ["uuid", "uuid"] }
```

```json
{ "reuniaoId": "uuid", "convidadosAgora": 7,
  "convitesEnviados": 122, "confirmados": 115 }
```

`convidadosAgora` menor que o pedido não é falha: os demais já estavam
convidados ou têm vínculo encerrado. Os dois números permitem a tela dizer isso
em vez de parecer que algo deu errado. Chamar duas vezes é seguro — não duplica
nem apaga resposta já dada.

Reunião cancelada ou encerrada recusa convites.

## `GET /api/reunioes/:id/participantes` — RF35, RF36

Parâmetros: `situacao` (`todos|presentes|ausentes|convidados|confirmados|pendentes|nao_registrados`),
`instituicaoId`, `busca`.

```json
{ "dados": [ ... ],
  "totais": { "total": 122, "presentes": 98, "ausentes": 24,
              "convidados": 3, "confirmados": 115, "pendentes": 7,
              "nao_registrados": 24 } }
```

`totais` é calculado sobre a lista **completa**, não sobre a filtrada: a tela
precisa mostrar "Presentes (98)" enquanto o usuário está na aba dos ausentes.

A lista junta convites e presenças com `full join` (view
`vw_reuniao_participante`). Um join comum perderia as duas pontas que mais
interessam: quem foi convidado e faltou, e quem apareceu sem ser chamado.

Cada combinação significa uma coisa:

| statusConfirmacao | statusPresenca | Significa |
|---|---|---|
| `confirmado` | `presente` | confirmou e veio |
| `confirmado` | `ausente` | confirmou e faltou |
| `pendente` | `null` | convidado, ainda não respondeu nem apareceu |
| `null` | `presente` | apareceu sem convite (o convidado avulso do QR) |

## `PATCH /api/convites/:id`

```json
{ "status": "confirmado", "observacoes": "Confirmou por telefone" }
```

Quem registra é o gestor: o representante não tem login, então a confirmação
chega por e-mail ou telefone e alguém do Centro anota.

**Confirmar não é estar presente.** A presença só existe depois do check-in ou
da marcação manual — quem confirma e falta continua sendo uma ausência, e é
justamente esse número que interessa medir.

Voltar para `pendente` limpa a data da resposta, senão a constraint
`convite_respondido_tem_data` recusaria a linha.

## `DELETE /api/convites/:id`

Só administrador. Se a pessoa já compareceu, a presença dela continua depois de
o convite sair — ela passa a constar como quem apareceu sem convite, que é
exatamente o que teria acontecido.

## `GET /api/representantes/:id` — RF41, RF44

Detalhe da pessoa com o histórico de participação.

```json
{ "id": "uuid", "nome": "José da Silva Júnior",
  "vinculos": [ ... ], "vinculoAtual": { "instituicao": "Startup Beta" },
  "participacaoPorInstituicao": [
    { "instituicao": "Universidade Alfa", "reunioesEsperadas": 12,
      "presencas": 12, "percentual": 100.0 },
    { "instituicao": "Startup Beta", "reunioesEsperadas": 4,
      "presencas": 2, "percentual": 50.0 }],
  "resumo": { "reunioesEsperadas": 16, "presencas": 14, "percentual": 87.5 },
  "historico": [{ "titulo": "Reunião de Março", "data": "2025-03-10",
                  "instituicao": "Universidade Alfa",
                  "statusPresenca": "presente" }] }
```

O ponto desta rota: **o histórico é por vínculo, não por pessoa.** Quem passou
pela Universidade Alfa até 05/2025 e hoje está na Startup Beta tem duas linhas,
cada uma contando só as reuniões do seu período. Somar tudo numa linha atribuiria
à Startup Beta reuniões de que ela nem participava ainda.

`resumo.percentual` vem `null` quando não houve nenhuma reunião esperada — 0%
seria uma acusação, e não a ausência de dado.

## `PATCH /api/representantes/:id`

Só `nome`, `email`, `telefone` e `observacoes`. **Cargo e instituição não se
editam aqui**: pertencem ao vínculo, e trocar o cargo de um vínculo antigo
reescreveria o histórico. Para mudar de instituição existe `POST /api/vinculos`;
para sair, `POST /api/vinculos/:id/encerrar`.

Campo não enviado não é tocado; enviar `""` limpa o campo de propósito.

## Códigos de erro acrescentados no Bloco B

| Código | HTTP | Quando |
|---|---|---|
| `REUNIAO_COM_PRESENCA` | 409 | exclusão barrada por presenças registradas |
| `REUNIAO_COM_DOCUMENTO` | 409 | exclusão barrada por documentos anexados |

---

# Rotas do Bloco C — documentos (entregues em 07/09)

## Onde os arquivos ficam

Os bytes são guardados no **próprio PostgreSQL**, numa tabela separada
(`documento_conteudo`). Não há S3, R2 nem bucket nenhum — e isso foi decisão,
não esquecimento:

- funciona hoje, sem conta nova, sem credencial e sem depender do DevOps, que é
  o gargalo do projeto desde 20/08;
- o backup do banco já leva os arquivos junto. Com armazenamento externo seriam
  dois backups, e o segundo é o que se esquece de configurar;
- o volume é pequeno: relatórios e recibos, alguns MB cada.

O custo: não escala para milhares de arquivos grandes. Por isso os bytes ficam
em tabela separada e `storage_path` já guarda a chave lógica do arquivo
(`instituicao/<uuid>/<uuid>-nome.pdf`). Migrar depois é subir cada blob para
esse caminho que já existe, trocar o adaptador em
`src/infraestrutura/armazenamento/` e apagar a tabela. O contrato desta API não
muda.

## `GET /api/documentos`

`?instituicaoId=...` **ou** `?reuniaoId=...` — exatamente um dos dois.

```json
{ "dados": [{
    "id": "uuid", "nome": "Relatório de Visitação",
    "descricao": "Visita de agosto", "tipo": null,
    "origem": "arquivo", "urlExterna": null,
    "mimeType": "application/pdf", "tamanhoBytes": 1258291,
    "checksum": "9f86d0...", "enviadoEm": "2026-08-21T14:02:00Z",
    "enviadoPor": "Administrador Kauan"
}], "total": 1 }
```

`origem` é `"arquivo"` (guardado aqui) ou `"link"` (mora fora). Para `link`,
`tamanhoBytes` e `mimeType` vêm nulos e o botão da tela abre `urlExterna` em vez
de chamar a rota de download.

A listagem nunca traz o conteúdo binário — é exatamente para isso que a tabela
de bytes é separada.

## `POST /api/documentos`

Duas formas, e a tela oferece as duas.

**Arquivo** — `multipart/form-data`, campo `arquivo` mais os campos de texto:

```
arquivo=<binário>  instituicaoId=<uuid>  descricao=Visita de agosto
```

**Link** — `application/json`, para o documento que já está no Drive:

```json
{ "reuniaoId": "uuid", "nome": "Ata no Drive",
  "urlExterna": "https://drive.google.com/file/d/abc/view" }
```

`201`:

```json
{ "id": "uuid", "nome": "Relatório.pdf", "origem": "arquivo",
  "mimeType": "application/pdf", "tamanhoBytes": 1258291,
  "checksum": "9f86d0...", "enviadoEm": "...", "jaExistia": false }
```

Regras que a rota impõe:

| Regra | Erro |
|---|---|
| Instituição **ou** reunião, nunca os dois nem nenhum | `DADOS_INVALIDOS` 422 |
| Arquivo **ou** link, nunca os dois nem nenhum | `DADOS_INVALIDOS` 422 |
| Limite de 20 MB (`UPLOAD_LIMITE_BYTES`) | `ARQUIVO_GRANDE_DEMAIS` 413 |
| Tipo na lista de permitidos | `TIPO_NAO_PERMITIDO` 415 |
| Conteúdo bate com o tipo declarado | `TIPO_NAO_PERMITIDO` 415 |
| Link começa com `http://` ou `https://` | `DADOS_INVALIDOS` 422 |

**Tipos aceitos:** PDF, PNG, JPEG, GIF, WebP, docx, xlsx, pptx, doc, xls, ppt,
txt, csv.

**Recusados de propósito:** HTML, SVG e qualquer executável. SVG carrega
`<script>`; servidos a partir do domínio do sistema, viram execução de script na
sessão de quem abre.

O mime que o navegador manda vem da extensão — é palpite, não prova. O servidor
confere os primeiros bytes do arquivo. Um HTML renomeado para `.pdf` é recusado
com `TIPO_NAO_PERMITIDO`, e a mensagem sugere conferir se o arquivo foi
renomeado, porque o caso honesto (planilha salva com extensão errada) é mais
comum que o mal-intencionado.

**Reenvio do mesmo arquivo** para o mesmo dono não cria segunda cópia: a
resposta vem com `jaExistia: true` e o id do documento que já estava lá. Clicar
duas vezes em "enviar" é a causa mais comum de anexo duplicado.

O nome do arquivo é sanitizado antes de virar caminho — acento, espaço, barra e
`..` saem. O `nome` que a tela mostra mantém a acentuação original; quem é
limpo é a chave de armazenamento.

## `GET /api/documentos/:id/conteudo`

Devolve os bytes. **Não é JSON** — a resposta é o arquivo.

Os cabeçalhos são a parte importante:

```
Content-Disposition: attachment; filename="..."; filename*=UTF-8''...
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
Cache-Control: private, no-store
```

O arquivo foi enviado por um usuário e é servido do mesmo domínio do sistema.
Sem `attachment` e `nosniff`, um arquivo malicioso que passasse pela conferência
de tipo rodaria script na sessão de quem clicasse — com o cookie junto. A
conferência dos bytes no envio e estes cabeçalhos na saída são as duas metades
da mesma proteção; nenhuma sozinha cobre tudo.

Pedir o conteúdo de um documento que é só link devolve `DOCUMENTO_E_LINK` (409),
com a URL em `extra.urlExterna` para a tela abrir.

## `DELETE /api/documentos/:id`

Só administrador. Documento pode ser removido, diferente de presença e de
vínculo: ele não sustenta indicador nenhum, e anexo trocado por engano é comum.

Os bytes são apagados junto. Blob órfão ocupando banco é o tipo de coisa que só
se descobre quando o disco enche.

## Efeito na exclusão de instituição e de reunião

Instituição com documentos anexados passa a ser protegida também:
`INSTITUICAO_COM_DOCUMENTO` (409). A 002 já barrava presença e vínculo, mas
`documento.instituicao_id` é `on delete cascade` — uma instituição só com
documentos ainda podia ser apagada levando os arquivos junto, em silêncio.

A reunião já estava protegida pela 003 (`REUNIAO_COM_DOCUMENTO`).

## Códigos de erro acrescentados no Bloco C

| Código | HTTP | Quando |
|---|---|---|
| `ARQUIVO_GRANDE_DEMAIS` | 413 | acima do limite; `extra.limiteBytes` traz o teto |
| `TIPO_NAO_PERMITIDO` | 415 | tipo fora da lista, ou conteúdo que não bate com ele |
| `DOCUMENTO_E_LINK` | 409 | pediram o conteúdo de um documento que é link |
| `INSTITUICAO_COM_DOCUMENTO` | 409 | exclusão barrada por documentos anexados |

413 e 415 são os códigos que o HTTP já tem para exatamente estes dois casos.
Usar 422 para tudo obrigaria o front a ler a mensagem para saber o que houve.

## Variáveis de ambiente

```
ARMAZENAMENTO=postgres        # único adaptador hoje; ver src/infraestrutura/armazenamento/porta.js
UPLOAD_LIMITE_BYTES=20971520  # 20 MB
```


---

# Autenticação e CORS — o projeto virou só back-end (10/09/2026)

As telas saíram de `src/app/`: a equipe é responsável apenas pelo back-end e o
front é outro projeto, em outro endereço. `src/app/` agora tem só `api/`.

## O que mudou para quem consome a API

| Antes | Agora |
|---|---|
| Login por Server Action, na tela `/login` | `POST /api/sessao` |
| `POST /sair`, com redirect para `/login` | `DELETE /api/sessao` |
| Sem sessão: redirect 307 para `/login` | Sem sessão: **401 `NAO_AUTENTICADO`** em JSON |
| `NEXT_PUBLIC_APP_URL` | `URL_FRONTEND` (o nome antigo continua aceito) |

A sessão continua num cookie `httpOnly` chamado `sessao`. O front precisa mandar
`credentials: 'include'` em **toda** chamada — sem isso o navegador não anexa o
cookie e a resposta é 401.

## `POST /api/sessao` — entrar (RF01)

```json
{ "email": "maria@centroinovacao.br", "senha": "..." }
```

200 — e o `Set-Cookie` da sessão vem junto:

```json
{
  "id": "uuid",
  "nome": "Maria",
  "email": "maria@centroinovacao.br",
  "papel": "gestor",
  "rotuloPapel": "Gestor",
  "menu": [
    { "rotulo": "Dashboard", "href": "/dashboard", "recurso": "indicador" },
    { "rotulo": "Instituições", "href": "/instituicoes", "recurso": "instituicao" }
  ]
}
```

`menu` já vem filtrado pelo papel (RF03): é a matriz de permissões do back-end,
para o front não reimplementar a regra na tela.

Erro: 401 `NAO_AUTENTICADO`, com a mesma mensagem para e-mail inexistente, senha
errada e conta desativada.

## `GET /api/sessao` — quem está logado

Mesma resposta do POST. 401 `NAO_AUTENTICADO` quando não há sessão válida. Serve
para o front decidir, ao abrir, se manda para o login ou para o painel.

## `DELETE /api/sessao` — sair

200 `{ "encerrada": true }`. Idempotente: responde igual mesmo sem sessão.

## `POST /api/senha/recuperar` — RF02

```json
{ "email": "maria@centroinovacao.br" }
```

200 sempre, exista ou não a conta:

```json
{ "mensagem": "Se existir uma conta com esse e-mail, enviamos as instruções para redefinir a senha." }
```

O link do e-mail aponta para `URL_FRONTEND/redefinir-senha?token=...` — a tela é
do front; o back só monta o endereço.

## `POST /api/senha/redefinir` — RF02

```json
{ "token": "...", "senha": "novaSenha123", "confirmacao": "novaSenha123" }
```

200 `{ "mensagem": "Senha alterada. Você já pode entrar com a nova senha." }`.
422 `DADOS_INVALIDOS` quando o link expirou, já foi usado ou as senhas não batem.

## Rotas públicas

Só estas quatro dispensam sessão: `/api/sessao`, `/api/senha/*`,
`/api/checkin/*` e `/api/saude`. Todas as outras respondem 401 sem o cookie,
antes mesmo de chegar na rota (`src/middleware.js`).

## CORS

O middleware libera **uma** origem: a configurada em `URL_FRONTEND`, com
`Access-Control-Allow-Credentials: true`. Requisição `OPTIONS` (preflight)
responde 204 com os métodos e `Content-Type` liberados.

Se o front rodar num domínio diferente do da API, o cookie só viaja com
`sameSite=none` — ligue `COOKIE_CROSS_SITE=1`. Isso exige HTTPS dos dois lados.
Com front e API sob o mesmo domínio, deixe desligado: `lax` é mais seguro.

## Variáveis de ambiente acrescentadas

```
URL_FRONTEND=https://front.exemplo.br   # origem liberada no CORS, base do QR e do link de senha
COOKIE_CROSS_SITE=0                     # 1 só quando front e API ficam em domínios diferentes
```
