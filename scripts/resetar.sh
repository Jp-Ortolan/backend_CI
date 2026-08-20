#!/usr/bin/env bash
# =============================================================================
# APAGA e recria o schema public, aplica todas as migrations e o seed.
#
#   ./scripts/resetar.sh
#
# Use no banco LOCAL. Recusa rodar se a URL não parecer local, para ninguém
# limpar homologação sem querer.
# =============================================================================
set -euo pipefail

URL="${DATABASE_URL_ADMIN:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  echo "Defina DATABASE_URL_ADMIN antes de rodar." >&2
  exit 1
fi

if [[ "$URL" != *localhost* && "$URL" != *127.0.0.1* && "${FORCAR:-0}" != "1" ]]; then
  echo "Esta URL não parece local. Se tem certeza, rode com FORCAR=1." >&2
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL=(psql "$URL" -v ON_ERROR_STOP=1 -q)

echo "==> recriando o schema public"
"${PSQL[@]}" -c "drop schema public cascade; create schema public;"

echo "==> aplicando migrations"
for f in "$RAIZ"/db/migrations/*.sql; do
  echo "    - $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "==> aplicando seed"
"${PSQL[@]}" -f "$RAIZ/db/seed.sql"

echo "==> pronto"
