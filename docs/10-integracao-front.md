# Guia de integração — front-end

Para quem está no `Rh4yanna/centro-inovacao` (React + Vite). Tudo aqui foi
conferido com requisições de verdade contra o servidor rodando em 24/09/2026 —
os exemplos são respostas reais, não inventadas.

## O essencial em cinco linhas

1. O back-end é **só API**. Não tem tela: `src/app/` só tem `api/`.
2. Endereço base: `https://<o-endereco-do-railway>/api`
3. **Toda** chamada precisa de `credentials: 'include'`. Sem isso o cookie de
   sessão não viaja e tudo volta 401.
4. Entra com `POST /api/sessao`. O cookie é `httpOnly` — você não consegue (nem
   precisa) lê-lo no JavaScript. O navegador manda sozinho.
5. Erro sempre vem no mesmo formato: `{ erro: { codigo, mensagem, campos } }`.

Cole o [`api.js`](#o-cliente-pronto) no projeto e você não precisa lembrar de
nada disso.

## Entrar e sair

```js
// entrar
const usuario = await api.post('/sessao', { email, senha });
// → { id, nome, email, papel, rotuloPapel, menu: [...] }

// quem está logado (use no carregamento do app)
const usuario = await api.get('/sessao');   // 401 se não estiver

// sair
await api.del('/sessao');
```

A resposta do login já traz o **menu que aquele perfil pode ver**:

```json
{
  "id": "1111...", "nome": "Ana Gestora", "papel": "admin",
  "rotuloPapel": "Administrador",
  "menu": [
    { "rotulo": "Dashboard",      "href": "/dashboard",      "recurso": "indicador" },
    { "rotulo": "Instituições",   "href": "/instituicoes",   "recurso": "instituicao" },
    { "rotulo": "Representantes", "href": "/representantes", "recurso": "representante" },
    { "rotulo": "Reuniões",       "href": "/reunioes",       "recurso": "reuniao" },
    { "rotulo": "Presenças",      "href": "/presencas",      "recurso": "presenca" }
  ]
}
```

Monte a barra lateral a partir desse array em vez de escrever os itens na mão:
assim o menu de um perfil de consulta já vem menor, sem `if` na tela.

Esconder item de menu é conveniência, não segurança — quem recusa de verdade é
o servidor. Digitar a URL na barra do navegador não dá acesso a nada.

## De-para dos campos — instituição

Os nomes que você usa hoje no `data.js` e os que a API espera:

| No seu código | Na API | Observação |
|---|---|---|
| `name` | `nome` | |
| `cnpj` | `cnpj` | pode mandar com pontuação; volta limpo e com `cnpjFormatado` junto |
| `email` | `email` | |
| `phone` | `telefone` | **obrigatório** |
| `site` | `site` | |
| `type` | `tipoInstituicaoId` | **número**, não texto — pegue em `GET /dominios` |
| `area` | `areaAtuacaoId` | **número**, idem |
| `founded` | `dataFundacao` | `AAAA-MM-DD`, **obrigatório** |
| `status` | `status` | só `ativa`, `inativa` ou `em_processo_entrada` (minúsculo) |
| `street` | `logradouro` | **obrigatório** |
| `number` | `numero` | |
| `neighborhood` | `bairro` | **obrigatório** |
| `city` | `cidade` | **obrigatório** |
| `state` | `estado` | a sigla: `PR` |
| `zip` | `cep` | |
| `complement` | `complemento` | |
| `description` | `descricao` | máximo 500 caracteres |

Os três que mais tropeçam: **`type` e `area` viram id numérico**, e **`status` é
minúsculo**. `"Ativa"` é recusado; `"ativa"` passa.

## Endpoints por tela

### Login e senha
| | |
|---|---|
| `POST /sessao` | entrar — `{ email, senha }` |
| `GET /sessao` | quem está logado |
| `DELETE /sessao` | sair |
| `POST /senha/recuperar` | `{ email }` — responde 200 mesmo se a conta não existir, de propósito |
| `POST /senha/redefinir` | `{ token, senha, confirmacao }` |

### Dashboard
`GET /indicadores` devolve tudo o que a tela mostra, numa chamada:

```json
{
  "cartoes": {
    "instituicoes": { "ativas": 3, "inativas": 1, "emProcesso": 1 },
    "representantesAtivos": 3,
    "reunioesRealizadas": 3,
    "reunioesAgendadas": 0,
    "mediaPresenca": "55.6"
  },
  "evolucaoParticipacao": [ { "mes": "2026-08", "percentual": 62.5 } ],
  "participacaoPorInstituicao": [ { "instituicao": "...", "percentual": 80 } ],
  "proximasReunioes": [ { "id": "...", "titulo": "...", "data": "...", "confirmados": 115 } ]
}
```

`mediaPresenca` vem `null` quando ainda não houve reunião encerrada — mostre
`—`, não `0%`. A **variação percentual** do Figma ("cresceu 8% neste mês") ainda
não existe na API; combine com o João Pedro se entra.

### Instituições
| | |
|---|---|
| `GET /instituicoes` | lista. Parâmetros: `busca`, `status`, `tipoInstituicaoId`, `cidade`, `pagina`, `porPagina`, `ordenarPor`, `ordem` |
| `GET /instituicoes/:id` | detalhe |
| `POST /instituicoes` | cadastrar |
| `PATCH /instituicoes/:id` | editar — mande **só os campos alterados** |
| `POST /instituicoes/:id/status` | ativar/desativar — `{ status, motivo }` |
| `DELETE /instituicoes/:id` | excluir (recusado se já houver histórico) |
| `GET /instituicoes/:id/historico` | aba de participação |

A listagem já vem paginada, com o que o rodapé precisa:

```json
{ "dados": [ ... ], "total": 122, "pagina": 1, "porPagina": 9, "paginas": 14 }
```

O `busca` é um campo só e resolve nome **ou** CNPJ — a API decide qual.

O detalhe devolve os blocos da tela já prontos: `endereco`, `classificacao`,
`representantes`, `documentos`, `participacao` e `cadastro` (este último com
*cadastrada por* / *atualizada por* já com nome de gente, não id).

### Representantes
| | |
|---|---|
| `GET /representantes` | lista. `busca`, `instituicaoId`, `vinculo`, `pagina`, `porPagina` |
| `GET /representantes/:id` | detalhe, com vínculos e histórico de presença |
| `POST /representantes` | cadastrar |
| `PATCH /representantes/:id` | editar |
| `POST /vinculos` | ligar pessoa existente a outra instituição |
| `POST /vinculos/:id/encerrar` | encerrar vínculo (não apaga: grava a data de fim) |

Cadastro em uma chamada só — pessoa e vínculo juntos:

```js
await api.post('/representantes', {
  nome: 'Mariana Tchermann Pereira',
  email: 'mariana.pereira@uninova.edu.br',
  cpf: '529.982.247-25',          // pode ir com pontuação
  telefone: '(42) 99999-6519',
  vinculo: { instituicaoId: '...', cargo: 'Coordenadora' },
});
```

Se o e-mail já existir, a API **reaproveita a pessoa** e só cria o vínculo novo
— é o caso de quem troca de instituição. A resposta não muda.

### Reuniões
| | |
|---|---|
| `GET /reunioes` | lista. `busca`, `status`, `de`, `ate`, `instituicaoId`, `pagina` |
| `GET /reunioes/:id` | detalhe, com participantes e documentos |
| `POST /reunioes` | cadastrar (`convidarTodos: true` já convida todos os vínculos ativos) |
| `PATCH /reunioes/:id` | editar |
| `POST /reunioes/:id/status` | agendada / realizada / cancelada |
| `POST /reunioes/:id/encerrar` | encerra e trava novos check-ins |
| `GET /reunioes/:id/participantes` | lista de presença |
| `POST /reunioes/:id/presencas` | marcar presença ou ausência na mão |
| `POST /reunioes/:id/convites` | convidar |

Campos: `titulo`, `data`, `horaInicio`, `horaFim`, `local`, `endereco`,
`descricao`, `pauta`, `link`, `senhaAcesso`, `checkinAbreEm`, `checkinFechaEm`.
O `link` precisa começar com `https://`.

### Documentos
| | |
|---|---|
| `GET /documentos?instituicaoId=...` | lista (sem os bytes — a listagem fica leve) |
| `POST /documentos` | enviar — `multipart/form-data`, ou `{ urlExterna }` para só guardar um link |
| `GET /documentos/:id/conteudo` | baixar (passa pela permissão; não tem URL pública) |
| `DELETE /documentos/:id` | remover |

O tipo do arquivo é conferido pelos **bytes**, não pela extensão. HTML e SVG são
recusados de propósito. Limite de 20 MB.

### Check-in por QR Code — **rotas públicas, sem login**
| | |
|---|---|
| `GET /checkin/:token` | dados da reunião e se o check-in está aberto |
| `GET /checkin/:token/buscar?termo=maria` | busca o participante (máx. 5 resultados) |
| `POST /checkin/:token` | registra a presença |

O `token` vem na URL do QR Code, que o back monta usando `URL_FRONTEND`. A
página que recebe esse link é sua: **essa tela ainda não existe nem no Figma
nem no código**, e é a funcionalidade principal do projeto. Vale combinar.

Tem limite por IP: 20 buscas e 10 registros por minuto. Estourou, volta 429.

### Listas fixas dos selects
`GET /dominios` → `{ tiposInstituicao: [{id, nome}], areasAtuacao: [{id, nome}] }`

Chame uma vez ao abrir o formulário e guarde — não muda durante a sessão.

## Erros

Sempre o mesmo formato:

```json
{
  "erro": {
    "codigo": "DADOS_INVALIDOS",
    "mensagem": "CPF inválido.",
    "campos": [ { "campo": "cpf", "mensagem": "CPF inválido." } ]
  }
}
```

`mensagem` é a que vai no topo do formulário; `campos` marca cada input de uma
vez, em vez de o usuário descobrir um erro por tentativa.

| Código | HTTP | O que fazer na tela |
|---|---|---|
| `NAO_AUTENTICADO` | 401 | mandar para o login |
| `SEM_PERMISSAO` | 403 | avisar que o perfil não permite |
| `NAO_ENCONTRADO` | 404 | |
| `DADOS_INVALIDOS` | 422 | marcar os campos |
| `CONFLITO` | 409 | ex.: CNPJ já cadastrado |
| `LIMITE_EXCEDIDO` | 429 | só no check-in |

## Rodar local

```bash
# no back-end
npm install
docker compose up -d
$env:DATABASE_URL_ADMIN = "postgresql://postgres:postgres@localhost:5432/postgres"
npm run db:testar          # cria o banco e imprime as URLs prontas
npm run dev                # http://localhost:3000
```

No seu projeto, um `.env`:

```
VITE_API_URL=http://localhost:3000/api
```

E em produção, o endereço do Railway. Avise o João Pedro quando publicar o
front: ele precisa pôr esse endereço na variável `URL_FRONTEND` do back, que é
o que libera a origem no CORS. Enquanto estiver errada, **toda** chamada sua é
bloqueada pelo navegador, antes mesmo de chegar na API.

## O cliente pronto

Em `docs/exemplos/api.js` tem um cliente de ~60 linhas: já põe o
`credentials: 'include'`, converte o erro em `Error` com `codigo` e `campos`, e
manda para o login sozinho no 401. Copie para `src/services/api.js`.

```js
import { api } from './services/api';

const { dados, total } = await api.get('/instituicoes', { pagina: 1, porPagina: 9 });
await api.post('/instituicoes', { nome: '...', /* ... */ });
await api.patch(`/instituicoes/${id}`, { telefone: '(42) 3333-3333' });
await api.del(`/instituicoes/${id}`);
```

## Três coisas que vão te custar uma tarde se ninguém avisar

1. **Faltou `credentials: 'include'`** — o login parece dar certo e a próxima
   chamada volta 401. É o erro mais comum, e o mais confuso.
2. **`URL_FRONTEND` errada no back** — o navegador bloqueia antes de sair, e o
   erro no console fala de CORS, não de configuração.
3. **`type` e `area` são id numérico**, e **`status` é minúsculo**.
