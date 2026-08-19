# Definição de pronto

Um card só sai de "Fazendo" quando **todos** os itens abaixo valem. Serve para
back-end, front-end e DevOps.

## Para qualquer card

- [ ] O requisito correspondente (RFxx / RNFxx) está atendido como escrito
- [ ] O código está em `develop` via PR aprovado, com CI verde
- [ ] Está funcionando em homologação, não só na máquina de quem fez
- [ ] O QA executou os casos de teste relacionados e registrou o resultado
- [ ] Nenhum defeito bloqueante ou de severidade alta em aberto no card

## Se mexeu no banco

- [ ] A mudança está numa **migration nova**, nunca editando uma já aplicada
- [ ] `./scripts/testar-banco.sh` passa
- [ ] Regra de negócio nova tem teste em `tests/`
- [ ] O DER foi atualizado, se a estrutura mudou

## Se criou endpoint

- [ ] O formato bate com `docs/04-contrato-de-api.md` (ou o documento foi atualizado)
- [ ] Os códigos de erro estão implementados e testados
- [ ] A rota exige autenticação — exceto as de check-in público, que validam o token
- [ ] `SUPABASE_SERVICE_ROLE_KEY` não aparece em código de cliente

## Se criou tela

- [ ] Confere com o protótipo do Figma
- [ ] Funciona em desktop e tablet; se for tela de check-in, em celular real
- [ ] Estados de carregamento, vazio e erro tratados
- [ ] Nenhuma regra de permissão depende só da interface

## Não conta como pronto

Código que só funciona local. Funcionalidade sem teste executado.
"Está pronto, falta só integrar." Card marcado como concluído porque a semana
acabou.
