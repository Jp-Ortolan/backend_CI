#!/usr/bin/env bash
# =============================================================================
# Aplica as migrations que ainda não rodaram, em ordem, uma vez cada.
#
#   ./scripts/migrar.sh
#
# Usa DATABASE_URL_ADMIN (o usuário DONO do banco). A aplicação nunca precisa
# desse usuário — ela conecta como app_web, que não é dono, para o RLS valer.
#
# No Railway: exporte DATABASE_URL_ADMIN com a string da aba Variables.
# =============================================================================
set -euo pipefail

URL="${DATABASE_URL_ADMIN:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  echo "Defina DATABASE_URL_ADMIN (ou DATABASE_URL) antes de rodar." >&2
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql "$URL" -v ON_ERROR_STOP=1 -q)

# Tabela de controle: é ela que garante que cada arquivo roda uma vez só.
"${PSQL[@]}" -c "create table if not exists migration_aplicada (
  arquivo text primary key,
  aplicada_em timestamptz not null default now()
);"

aplicadas=0
for f in "$RAIZ"/banco/migrations/*.sql; do
  nome="$(basename "$f")"
  ja=$("${PSQL[@]}" -tAc "select count(*) from migration_aplicada where arquivo = '$nome'")
  if [ "$ja" != "0" ]; then
    echo "  = $nome (já aplicada)"
    continue
  fi
  echo "  + $nome"
  "${PSQL[@]}" -f "$f"
  "${PSQL[@]}" -c "insert into migration_aplicada (arquivo) values ('$nome')"
  aplicadas=$((aplicadas + 1))
done

echo ""
echo "==> $aplicadas migration(s) aplicada(s)"
