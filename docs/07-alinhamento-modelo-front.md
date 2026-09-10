# Alinhamento do modelo de dados com as telas

**07/09/2026 · back-end → front-end e equipe**

Resposta à proposta de 13 tabelas montada a partir das telas do Figma.

O resumo é: **a proposta bate com o que já existe.** Das 13 tabelas, 9 já
estavam no banco desde a Semana 2, com outro nome. As 4 que faltavam de verdade
entraram na migration `002_alinhamento_telas.sql`, junto com 7 campos que só
apareceram quando as telas de cadastro ficaram prontas.

Três pontos saíram diferentes da proposta, e cada um tem o motivo escrito
abaixo. As duas perguntas que a proposta deixou em aberto — exclusão de
instituição e fórmula da média de presença — estão respondidas e implementadas.

---

## 1. Mapa de nomes

A proposta usa plural e sufixo (`usuarios`, `instituicao_representantes`). O
banco usa singular, que foi o padrão fechado na Semana 1 e já está em 834 linhas
de migration, 54 testes e no DER. **Não vale trocar agora** — é renomeação de
tudo por preferência de estilo, a 23 dias da entrega.

Este mapa é o que o front precisa para escrever as consultas:

| Proposta do front | No banco | Situação |
|---|---|---|
| `usuarios` | `usuario` | Existe. `perfil` chama-se `papel` (enum `admin`/`gestor`/`leitura`) |
| `instituicoes` | `instituicao` | Existe, com campos novos na 002 |
| `enderecos_instituicoes` | colunas em `instituicao` | **Divergência 1** — ver abaixo |
| `tipos_instituicao` | `tipo_instituicao` | Existe. Ganhou `ativo` na 002 |
| `areas_atuacao` | `area_atuacao` | **Novo na 002** |
| `representantes` | `pessoa` | Existe. Pessoa é pessoa, mesmo trocando de instituição |
| `instituicao_representantes` | `vinculo` | Existe. É o coração do modelo |
| `reunioes` | `reuniao` | Existe. Ganhou `endereco` na 002 |
| `reuniao_participantes` | `reuniao_convite` + `presenca` | **Divergência 2** — ver abaixo |
| `documentos_instituicoes` | `documento` | Existe, e também serve reunião |
| `notificacoes` | `notificacao` | **Novo na 002** |
| `recuperacoes_senha` | `token_recuperacao` | Existe desde a Semana 2 |
| `logs_auditoria` | `log_auditoria` | **Novo na 002** |

Sobre `representantes` → `pessoa` e `instituicao_representantes` → `vinculo`:
a diferença não é só de nome. **Representante não é uma pessoa, é o vínculo
entre uma pessoa e uma instituição num período.** É o que permite alguém sair da
Universidade Nova, entrar na Startup X, e as presenças de 2025 continuarem
contando para a Universidade Nova. A proposta já previa isso na tabela de
vínculo — está certa, é a mesma ideia.

---

## 2. O que a migration 002 acrescentou

Quase tudo veio do formulário "Nova instituição" e do dashboard, que a Semana 2
não tinha como prever porque as telas ainda não existiam.

**Cadastro de instituição** — `logradouro`, `numero`, `bairro`, `cep`,
`complemento`, `data_fundacao`, `descricao` (limitada a 500 caracteres, igual ao
contador da tela), `area_atuacao_id`.

**Reunião** — `endereco`, para a segunda linha do bloco "Próximas reuniões"
("Auditório" em cima, "Prefeitura de Guarapuava" embaixo). `local` passa a
significar a sala.

**Convite e confirmação** — tabela `reuniao_convite`, que é de onde sai o
"115 confirmados" do dashboard. Junto vem a função
`convidar_representantes_ativos(reuniao_id)`, que convida de uma vez todos os
vínculos ativos de instituições ativas — com 122 instituições, convidar na mão
não é opção. Rodar duas vezes não duplica ninguém nem apaga resposta já dada.

**Notificações** — tabela `notificacao`, para o sino e o contador. Cada usuário
só enxerga as próprias, garantido no banco e não no front.

**Log de auditoria** — `log_auditoria` grava inserção, alteração e exclusão das
8 tabelas principais, registrando só os campos que mudaram de fato, com antes e
depois. `senha_hash` nunca entra no log. Atende o "Cadastrada por / Atualizada
por" da tela de detalhe e serve de prova em qualquer discussão sobre quem mexeu
em quê.

Validações que o banco passou a impor: CEP só dígitos, descrição até 500
caracteres, data de fundação não pode ser futura. **Regra que só existe no
front não é regra** — um POST direto na API passaria por cima dela.

---

## 3. As três divergências

### Divergência 1 — endereço fica na instituição, não em tabela separada

A proposta previa `enderecos_instituicoes` como tabela própria.

Nas telas, cada instituição tem exatamente um endereço: o formulário tem um
bloco só e a tela de detalhe mostra um card só. Uma tabela 1:1 custaria um join
em toda listagem e todo detalhe para permitir uma cardinalidade que nenhuma tela
usa.

Se um dia entrar "filiais", aí a tabela separada se justifica — e ela nasce
nova, sem mexer no que já está rodando.

### Divergência 2 — convite e presença são duas tabelas

A proposta previa `reuniao_participantes` juntando convite, confirmação e
presença numa linha só.

São dois fatos de naturezas diferentes:

- **convite** é intenção, muda de estado, existe **antes** da reunião
- **presença** é fato consumado, com o retrato do vínculo naquele dia, existe **depois**

Numa tabela única, toda linha nasceria como convite vazio. As garantias que o
banco já dá sobre presença — "quem está presente tem horário", "convidado não
carrega vínculo oficial" — teriam de virar opcionais, porque no momento do
convite nada disso existe ainda. O banco pararia de proteger justamente o dado
que o relatório final usa.

Separado, cada tabela responde uma pergunta: `reuniao_convite` diz quantos
confirmaram, `presenca` diz quantos apareceram. E o convidado que chega sem
convite entra só na presença, que é exatamente o certo.

**Para o front isso não muda quase nada:** a view `vw_resumo_reuniao` já devolve
`convites_enviados`, `confirmados`, `presentes`, `ausentes` e `esperados` na
mesma linha. A tela consulta uma view, não duas tabelas.

### Divergência 3 — reunião guarda data e hora separadas

A proposta previa `inicio_em` e `fim_em` como timestamps.

O banco tem `data` (date), `hora_inicio` e `hora_fim` (time). É o que já está
implementado e testado, e é o que as telas mostram: o dashboard exibe "12 SET" e
"13:00" em colunas diferentes, e a listagem agrupa por dia.

Junto com data e hora existem `checkin_abre_em` e `checkin_fecha_em`, esses sim
timestamps, porque a janela do QR Code precisa de precisão real.

**Não é divergência que valha discutir muito** — se a equipe preferir timestamp
único, a conversão é uma migration pequena. Só não vale fazer sem motivo.

---

## 4. As duas perguntas em aberto — respondidas

### "Como a exclusão de instituição preservará o histórico?"

**Instituição com histórico não se exclui, se desativa.** Está implementado.

A 001 já barrava a exclusão quando existiam vínculos. O buraco era a presença:
`presenca.instituicao_id` era `on delete set null`, então apagar a instituição
não daria erro — apagaria em silêncio o nome de quem participou das reuniões
passadas. Uma trigger fecha isso.

O botão "Excluir instituição" da tela continua fazendo sentido: serve para o
cadastro criado por engano, que ainda não tem histórico nenhum. Esse sai
normalmente.

O que o front precisa tratar:

| Código do erro | Situação | O que a tela mostra |
|---|---|---|
| `INSTITUICAO_COM_HISTORICO` | Há presenças registradas | "Esta instituição já participou de reuniões e não pode ser excluída. Você pode desativá-la." |
| `INSTITUICAO_COM_VINCULO` | Há vínculos, mesmo encerrados | "Encerre os vínculos antes de excluir, ou desative a instituição." |

E o caminho certo, o de sempre, é o botão "Desativar instituição" que a tela já
tem: `status = 'inativa'` com `data_saida` preenchida. O banco exige a data —
instituição inativa sem data de saída é recusada.

### "Qual é a fórmula da média de presença e quem entra na conta?"

Boa pergunta, e ela achou um erro. **A fórmula que estava no banco estava
errada.**

O que estava valendo: `presentes ÷ total de linhas na tabela de presença`.

Dois problemas:

1. Quem nunca foi registrado não entrava no denominador. Uma reunião com 3
   registros e 3 presentes dava **100%**, mesmo com 122 instituições
   convidadas.
2. Convidado avulso entrava no denominador e derrubava o índice de quem não
   tinha nada a ver com aquilo.

**O que passa a valer:**

```
comparecimento = representantes presentes ÷ vínculos vigentes na data da reunião
```

Quem entra na conta: só quem tinha vínculo ativo **na data daquela reunião** —
não o vínculo de hoje. Quem entrou na instituição depois não é cobrado por
reunião que aconteceu antes dele.

Quem **não** entra: convidado avulso, nem no numerador nem no denominador. Ele
não era esperado; o indicador mede quem era esperado e apareceu.

A média do dashboard é a média desse número entre as reuniões **encerradas**.
Reunião em andamento sempre teria índice baixo e puxaria a média para baixo sem
significar nada.

O efeito no banco de teste: uma reunião que marcava 100% passou a marcar 66,7%,
e a média geral caiu de 77,8% para 55,6%. **O número vai piorar quando isso
subir com dados reais** — e é bom que piore, porque o de antes estava mentindo.

Duas colunas convivem na view, de propósito: `percentual_presenca` é a antiga e
segue existindo para não quebrar o que já consulta ela; `percentual_comparecimento`
é a correta e é a que o dashboard usa.

---

## 5. O que ainda depende de tela

O modelo cobre com folga instituições e o dashboard, que são as telas que
chegaram. Três pontos continuam sem validação porque as telas não foram
enviadas:

1. **Representantes** — a proposta previa `status` na pessoa. Hoje o status está
   no vínculo, que é onde ele significa alguma coisa. Se a tela de
   representantes tiver um "ativo/inativo" da pessoa **independente** dos
   vínculos, aí é campo novo. Precisa da tela para decidir.

2. **Reuniões** — falta ver a tela de criação para saber se o convite é
   automático (todo mundo ativo) ou escolhido a dedo. A função de convite em
   massa já está pronta; a seleção individual é uma tela, não uma tabela.

3. **Presenças** — falta ver como a marcação manual aparece. O banco já aceita
   presença com `origem = 'manual'`, mas quem pode marcar e até quando é regra
   de negócio, não de banco.

---

## 6. Como aplicar

```bash
./scripts/migrar.sh          # aplica só o que ainda não rodou
./scripts/testar-banco.sh    # 54 testes, incluindo os 18 novos da 002
```

A 002 foi aplicada e testada num PostgreSQL 16 limpo: 001 + 002 + seed + os 5
arquivos de teste, tudo do zero, 54 testes verdes. Os 36 testes que já existiam
continuam passando sem alteração.

**A 001 não foi editada.** Ela já rodou; migration aplicada é história, e
reescrever história quebra o banco de quem já aplicou.
