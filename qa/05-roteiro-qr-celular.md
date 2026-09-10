# Roteiro — check-in por QR Code em celular real

Trilha QA · card "Testes do fluxo de QR Code em celular real" (Semana 4)

Este é o único teste do projeto que **não pode ser automatizado nem simulado**.
Tudo o mais tem teste de banco ou de integração; aqui o que está sendo medido é
a câmera de um celular de verdade, apontada para uma tela de verdade, por uma
pessoa que nunca viu o sistema. Um teste que roda no navegador do desenvolvedor
com a URL colada na barra de endereços não prova nada disso.

E é o fluxo com a maior consequência se falhar: acontece uma vez, na frente de
120 pessoas, e não tem segunda tentativa.

---

## Antes de começar

- [ ] Homologação no ar (`/api/saude` respondendo `ok`)
- [ ] Uma reunião cadastrada **com a data de hoje**
- [ ] Pelo menos 3 representantes com vínculo ativo, de instituições diferentes
- [ ] Um deles com nome acentuado e composto (ex.: "José da Conceição Júnior")
- [ ] O QR Code aberto numa tela grande, como estará na reunião

**Celulares:** no mínimo um Android e um iPhone. A câmera nativa do iOS abre a
URL de um jeito e a do Android de outro, e é aí que aparece diferença.

Anotar em `04-registro-de-execucao.md`: modelo, sistema, navegador e se estava
em Wi-Fi ou 4G.

---

## Parte 1 — Ler o código

| # | Passo | Esperado | OK |
|---|---|---|---|
| 1.1 | Abrir a câmera nativa e apontar para o QR na tela | O aviso de link aparece em menos de 3 segundos | ☐ |
| 1.2 | Tocar no aviso | A página de check-in abre no navegador | ☐ |
| 1.3 | Observar a página sem rolar | Título, data e local da reunião visíveis, e o campo de busca alcançável com o polegar | ☐ |
| 1.4 | Repetir a 2 metros da tela | Ainda lê | ☐ |
| 1.5 | Repetir em ângulo de uns 45° | Ainda lê | ☐ |
| 1.6 | Repetir com a tela mais escura | Ainda lê | ☐ |

Se 1.4 ou 1.5 falharem, o QR precisa ser maior na projeção. Descobrir isso agora
é barato; no dia da reunião, não.

## Parte 2 — Representante encontra o próprio nome

| # | Passo | Esperado | OK |
|---|---|---|---|
| 2.1 | Digitar as 3 primeiras letras do nome | A lista aparece sem precisar apertar nada | ☐ |
| 2.2 | Digitar o nome **sem acento** ("jose") | Encontra "José" | ☐ |
| 2.3 | Digitar duas palavras soltas ("jose junior") | Encontra "José da Conceição Júnior" | ☐ |
| 2.4 | Digitar só 2 letras | Pede ao menos 3 letras, sem parecer erro | ☐ |
| 2.5 | Tocar no próprio nome e confirmar | Confirmação com nome, instituição e horário | ☐ |
| 2.6 | Conferir o horário mostrado | É o horário local, não UTC | ☐ |

O 2.6 é fácil de deixar passar: uma diferença de 3 horas parece detalhe na tela
e vira reclamação quando alguém compara com o relógio.

## Parte 3 — Os caminhos que dão errado

| # | Passo | Esperado | OK |
|---|---|---|---|
| 3.1 | Escanear de novo e confirmar a mesma pessoa | **Mensagem de sucesso**, dizendo que já estava registrada e a que horas | ☐ |
| 3.2 | Buscar um nome que não existe | Oferece o caminho de convidado, sem parecer erro | ☐ |
| 3.3 | Entrar como convidado, com nome e instituição | Presença registrada como convidado | ☐ |
| 3.4 | Tentar convidado só com o primeiro nome | Pede o nome completo | ☐ |
| 3.5 | Abrir a URL de uma reunião **encerrada** | Avisa que o registro está fechado | ☐ |
| 3.6 | Trocar um caractere do token na URL | Avisa que a reunião não foi encontrada | ☐ |
| 3.7 | Ativar o modo avião e tentar confirmar | Mensagem de falha de conexão, sem tela branca e sem travar | ☐ |

**3.1 é o caso mais importante de toda a lista.** A pessoa que escaneia duas
vezes fez a coisa certa duas vezes. Se a tela responder com cara de erro, ela vai
procurar alguém para reclamar — e no dia da reunião esse alguém é você.

## Parte 4 — Várias pessoas ao mesmo tempo

Com 3 a 5 celulares diferentes, ao mesmo tempo:

| # | Passo | Esperado | OK |
|---|---|---|---|
| 4.1 | Todos escaneiam juntos | Todos abrem em menos de 5 segundos | ☐ |
| 4.2 | Todos confirmam ao mesmo tempo | Todas as presenças gravadas, nenhuma duplicada | ☐ |
| 4.3 | Abrir a lista de presença no painel | Bate exatamente com quem confirmou | ☐ |
| 4.4 | Dois celulares na mesma rede 4G, muitas buscas seguidas | Pode aparecer "muitas tentativas" (RNF14) — é o comportamento certo | ☐ |

Sobre 4.4: o limite é por IP, e vários celulares na mesma rede saem pelo mesmo
IP. **É esperado no teste e é um risco real na reunião** — 120 pessoas no Wi-Fi
do auditório compartilham um IP só. Ver a nota de risco no fim.

## Parte 5 — Acessibilidade básica

| # | Passo | Esperado | OK |
|---|---|---|---|
| 5.1 | Aumentar a fonte do sistema para o máximo | A tela continua utilizável | ☐ |
| 5.2 | Usar o celular na horizontal | Sem rolagem horizontal e sem corte | ☐ |
| 5.3 | Pedir a alguém de fora da equipe para fazer o check-in sozinho, sem instrução | Consegue sem perguntar nada | ☐ |

5.3 é o teste de verdade. Se a pessoa precisar perguntar como faz, a tela ainda
não está pronta — e 120 pessoas vão precisar perguntar a mesma coisa.

---

## Riscos a levar para a reunião

**O limite por IP e o Wi-Fi do auditório.** O limite atual é de 20 buscas e 10
registros por minuto, por IP. Numa rede compartilhada, 120 pessoas chegando
juntas passam disso com facilidade e vão receber "muitas tentativas" sem terem
feito nada de errado.

Três saídas, em ordem de preferência:

1. Subir o limite para o dia da reunião (`LIMITES` em
   `src/infraestrutura/http/limite.js`), e devolver depois.
2. Contar por IP **e** token de reunião juntos, em vez de só por IP.
3. Pedir que as pessoas usem 4G em vez do Wi-Fi da casa — a menos confiável,
   porque depende de cada um.

**Decidir isso antes da primeira reunião de verdade.** Vale registrar a decisão
em `docs/09-operacao.md`.

---

## Depois de executar

1. Registrar cada linha em `04-registro-de-execucao.md`, com data, ambiente e
   os aparelhos usados.
2. Abrir issue para cada ☐ que falhou, com foto ou vídeo da tela — em teste de
   celular, descrição escrita quase nunca é suficiente para reproduzir.
3. Se qualquer item da Parte 3 falhar, **é bloqueante**: são os caminhos que
   mais acontecem em uso real.
