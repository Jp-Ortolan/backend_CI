# Plano de testes — trilha QA

Sistema de Gestão do Ecossistema de Inovação · versão 1.0

## Objetivo

Verificar que o sistema atende aos requisitos do documento de requisitos antes da
entrega de 30/09/2026, com atenção especial ao fluxo de check-in por QR Code, que
é o único ponto com uso simultâneo por pessoas de fora da equipe e sem
possibilidade de repetir o teste em condição real.

## Escopo

**Em teste na primeira versão:** autenticação e perfis, cadastro de instituições,
cadastro de representantes e vínculos, cadastro de reuniões, check-in por QR Code,
lista de presença, histórico de participação, painel de indicadores.

**Fora:** relatórios exportáveis, importação de planilhas e workflow de
atualização cadastral — não integram o MVP.

## Níveis de teste

| Nível | O que cobre | Quem executa | Quando |
|---|---|---|---|
| Banco | Constraints, triggers e cálculo das views | Automatizado (`tests/*.sql`) | Todo push e PR |
| Funcional | Casos de teste manuais sobre a interface | QA | Ao fim de cada semana |
| Integração | Fluxo completo front + back em homologação | QA | Semana 6 |
| Segurança | Permissão por perfil, RLS, exposição de dados | QA + Back-end | Semana 6 |
| Carga | Check-in simultâneo (RNF09) | QA + DevOps | Semana 4 e Semana 6 |
| Usabilidade | Check-in em celular real com pessoas de fora | QA + UX | Semana 4 e Semana 6 |

### Sobre o nível de banco

As regras que o banco garante estão em `tests/01-regras-de-negocio.sql` e
`tests/02-indicadores.sql`. Cada teste tenta violar uma regra e falha se o banco
aceitar. Rodam no CI a cada PR, então uma regressão aparece antes da revisão.

Rodar localmente:

```bash
./scripts/testar-banco.sh
```

QA não precisa saber escrever SQL para usar isso — precisa saber ler a saída e
cobrar teste novo quando uma regra nova entra.

## Ferramentas

| Uso | Ferramenta |
|---|---|
| Regra de negócio no banco | psql + scripts em `tests/` (já configurado) |
| Registro de defeito | Issues do GitHub, template `bug.md` |
| Acompanhamento dos casos | Este repositório (`qa/02-casos-de-teste.md`) |
| Teste de API | Insomnia ou Postman, coleção compartilhada |
| Carga no check-in | k6 ou 15 celulares de verdade na sala |
| Navegadores | Chrome, Edge, Firefox e Safari (RNF26) |

Para o teste de carga, vale mais organizar uma simulação com a equipe e alguns
convidados lendo o QR ao mesmo tempo do que montar script sintético: o objetivo
é descobrir problema de rede e de usabilidade sob pressão, não medir servidor.

## Critérios

**Entrada:** funcionalidade implantada em homologação, com os dados de seed
carregados e o requisito correspondente identificado.

**Saída:** todos os casos de prioridade alta executados; nenhum defeito
bloqueante ou de severidade alta em aberto; testes automatizados de banco verdes.

## Severidade

| Nível | Definição | Prazo |
|---|---|---|
| Bloqueante | Impede o uso do sistema ou corrompe dado | Correção imediata, trava o merge |
| Alta | Funcionalidade principal quebrada sem contorno | Mesma semana |
| Média | Funcionalidade quebrada com contorno possível | Antes do code freeze (23/09) |
| Baixa | Cosmético ou de baixo impacto | Se houver folga |

Perda ou reescrita de histórico de participação é **sempre bloqueante**, mesmo
que pareça pequena. É o dado que o sistema existe para proteger.

## Calendário

| Semana | Foco do QA |
|---|---|
| 2 (20–26/08) | Montar homologação; testar login, recuperação de senha e permissão por perfil |
| 3 (27/08–02/09) | Instituições, representantes, vínculos; conferir preservação de histórico |
| 4 (03–09/09) | Check-in em celular real; duplicidade, convidado, janela de horário, carga |
| 5 (10–16/09) | Conferir os indicadores contra cálculo manual em planilha |
| 6 (17–23/09) | Integração, segurança, regressão e homologação com o Centro de Inovação |
| 7 (24–30/09) | Validação final em produção |

Na Semana 5, conferir os percentuais **na mão** contra uma planilha. É o único
jeito de saber se a view está certa — e é justamente o número que a gestão vai
usar para tomar decisão.

## Riscos

| Risco | Mitigação |
|---|---|
| Check-in falhar na reunião real, sem repetição possível | Ensaio com pessoas de fora na Semana 4 e plano B em papel na primeira reunião |
| Indicador plausível mas errado | Conferência manual contra planilha na Semana 5 |
| Regressão no histórico ao mexer em vínculo | Testes automatizados de banco rodando em todo PR |
| Testar só em Wi-Fi da instituição | Testar também em 4G, que é o que o participante vai usar |
