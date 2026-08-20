# Contrato de API — trilha Back-end

O front-end precisa disso definido antes de começar as telas. Enquanto as rotas
não existem, ele trabalha com mock em cima destes formatos.

Toda leitura e escrita passa por Server Component ou Server Action, dentro de
`comUsuario(...)` — a transação que declara quem é o usuário para o RLS. Route
Handler próprio existe só onde há regra que não cabe numa policy, e é neles que
este documento se concentra.

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

| Semana | Entregar |
|---|---|
| 2 (20–26/08) | Migrations, RLS, autenticação. Nenhuma rota própria ainda. |
| 3 (27/08–02/09) | CRUD pelo SDK + `POST /api/vinculos/:id/encerrar` |
| 4 (03–09/09) | As três rotas de `/api/checkin` + `POST /api/reunioes/:id/encerrar` |
| 5 (10–16/09) | Consultas às views e upload de documentos |
