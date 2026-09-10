# Registro de execução dos testes

Preencher a cada rodada. Uma linha por caso executado.

**Resultado:** Passou · Falhou · Bloqueado · Não aplicável

---

## Baterias automatizadas

Rodam a cada push e antes de cada merge. Quando falha, o commit não entra — por
isso não há linha "Falhou" aqui: o que falha não chega a ser registrado, é
corrigido antes.

| Data | Ambiente | Bateria | Testes | Resultado | Observação |
|---|---|---|---|---|---|
| 08/09/2026 | Local (Postgres 16) | Banco (`testes/banco/*.sql`) | 75 | Passou | Migrations 001 a 004 |
| 08/09/2026 | Local (Postgres 16) | Domínio | 21 | Passou | CNPJ, permissões, tipos de arquivo |
| 08/09/2026 | Local (Postgres 16) | Aplicação | 74 | Passou | Conectando como `app_web` |
| 10/09/2026 | Local (Postgres 16) | Banco | 80 | Passou | Com a 005 (limite do check-in) |
| 10/09/2026 | Local (Postgres 16) | Aplicação | 74 | Passou | — |
|  |  |  |  |  |  |

Para reproduzir:

```bash
./scripts/testar-banco.sh
npm run test:dominio
DATABASE_URL=... DATABASE_URL_ADMIN=... npm run test:integracao
```

---

## Casos manuais

| Data | Ambiente | Versão / commit | Caso | Resultado | Issue | Observação |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

### Check-in em celular (roteiro `05-roteiro-qr-celular.md`)

Registrar **modelo, sistema e navegador** de cada aparelho — a maioria dos
defeitos deste fluxo só aparece em um aparelho específico.

| Data | Aparelho | Sistema | Navegador | Rede | Partes 1–5 | Observação |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

---

## Validação do backup

Card "Validação do backup automático" (Semana 5). Backup que nunca foi
restaurado é esperança, não backup — esta tabela é o que transforma um no outro.

| Data | Dump usado | Restaurado em | Contagens conferem? | Observação |
|---|---|---|---|---|
|  |  |  |  |  |

Procedimento em `docs/09-operacao.md`, seção 3.

---

## Resumo por semana

| Semana | Previstos | Executados | Passaram | Falharam | Defeitos abertos |
|---|---|---|---|---|---|
| 2 | 6 |  |  |  |  |
| 3 | 13 + CT53, CT54, CT62 |  |  |  |  |
| 4 | 15 + CT55 a CT59 |  |  |  |  |
| 5 | 6 + CT46 a CT52, CT60, CT61 |  |  |  |  |
| 6 | 5 |  |  |  |  |

Os casos CT46 a CT62 entraram em 10/09, cobrindo documentos, convites,
confirmação, marcação manual, histórico por instituição e as regras de exclusão
protegida.
