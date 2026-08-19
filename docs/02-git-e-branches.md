# Git, branches e revisão — trilha DevOps

## Branches

| Branch | Papel | Deploy |
|---|---|---|
| `main` | O que está em produção. Só recebe merge vindo de `develop`. | Produção (Vercel) |
| `develop` | Integração. É daqui que sai a homologação. | Homologação |
| `tipo/RFxx-descricao` | Trabalho do dia a dia. Sai de `develop`, volta por PR. | Preview automático |

`main` e `develop` protegidas: sem push direto, PR obrigatório, CI verde para
poder dar merge.

### Nome da branch

```
feat/RF15-vinculo-representante
fix/RF34-checkin-duplicado
chore/configurar-github-actions
docs/plano-de-testes
```

Prefixos: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.
Amarrar ao ID do requisito faz o board, o commit e o documento falarem a mesma língua.

## Commits

Conventional Commits, em português:

```
feat(instituicoes): cadastro e edição de instituição
fix(checkin): impedir registro fora da janela da reunião
chore(ci): adicionar job de testes do banco
```

Escopos sugeridos: `instituicoes`, `representantes`, `vinculos`, `reunioes`,
`checkin`, `presenca`, `dashboard`, `auth`, `db`, `ci`.

## Pull Request

1. Abrir contra `develop`, preencher o template.
2. CI precisa passar (`Banco de dados` e `Aplicação`).
3. Uma aprovação de outra pessoa. Back-end revisa back-end; front revisa front.
   Nas duas primeiras semanas, revisão cruzada entre trilhas ajuda todo mundo a
   entender o modelo.
4. **Squash and merge**, para o histórico de `develop` ficar legível.

## Migrations — a regra mais importante

**Nunca edite uma migration que já foi aplicada em outro ambiente.** Crie uma
nova. Se você mudar um arquivo que o colega já rodou, o banco dele fica em um
estado que nenhum comando reproduz, e a diferença só aparece em produção.

Para gerar:

```bash
supabase migration new descricao_curta
```

Nome de arquivo: `AAAAMMDDHHMMSS_descricao_em_minusculas.sql`. O CI recusa
qualquer outro formato e recusa timestamps repetidos — o que acontece quando duas
pessoas criam migration no mesmo minuto em branches diferentes.

## Rotina da semana

O cronograma tem reunião toda quinta. Sugestão:

- **Quinta, na reunião** — demonstrar o que ficou pronto (não relatar; mostrar).
- **Quinta, depois** — mover os cards da semana seguinte para "Fazendo".
- **Segunda** — 15 minutos de alinhamento: o que travou, o que depende de quem.
- **Quarta** — congelar merges em `develop` no fim do dia, para a demo de quinta
  sair de um estado estável.
