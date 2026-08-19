# Contrato de API — trilha Back-end

O front-end precisa disso definido antes de começar as telas. Enquanto as rotas
não existem, ele trabalha com mock em cima destes formatos.

Com Supabase, boa parte do CRUD sai direto do client SDK aplicando RLS. Route
Handler próprio só onde há regra de negócio que não cabe numa policy — que é
exatamente onde este documento se concentra.

## Convenções

- Datas em ISO 8601. `timestamptz` sempre em UTC; a formatação é do front.
- Erro no formato `{ "erro": { "codigo": "...", "mensagem": "..." } }`.
- Paginação por `?pagina=1&porPagina=20`; resposta traz `{ dados, total, pagina }`.
- `codigo` é estável e serve para o front decidir o que mostrar; `mensagem` é
  texto em português e pode mudar.

## Direto pelo SDK (sem rota própria)

| Operação | Chamada | Requisito |
|---|---|---|
| Listar instituições com filtro | `from('instituicao').select().eq('status', ...)` | RF11, RF12 |
| Detalhe da instituição | `select('*, vinculo(*, pessoa(*)), documento(*)')` | RF08 |
| Criar / editar instituição | `insert` / `update` | RF06, RF07 |
| Listar reuniões | `from('reuniao').select()` | RF24 |
| Indicadores | `from('vw_dashboard').select().single()` | RF46 |
| Histórico por representante | `from('vw_participacao_representante').select()` | RF41 |

O RLS já garante que só admin e gestor escrevem. Não replicar essa checagem no
front como se fosse segurança — lá é só experiência de uso.

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

| Semana | Entregar |
|---|---|
| 2 (20–26/08) | Migrations, RLS, autenticação. Nenhuma rota própria ainda. |
| 3 (27/08–02/09) | CRUD pelo SDK + `POST /api/vinculos/:id/encerrar` |
| 4 (03–09/09) | As três rotas de `/api/checkin` + `POST /api/reunioes/:id/encerrar` |
| 5 (10–16/09) | Consultas às views e upload de documentos |
