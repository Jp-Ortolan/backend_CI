#!/usr/bin/env bash
# =============================================================================
# Recria um banco descartável, aplica as migrations, o seed e roda os testes.
#
#   ./scripts/testar-banco.sh
#
# Variáveis (padrão = Postgres local):
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres
#   BANCO=ecossistema_teste
#
# No Railway, exporte as variáveis da aba Variables antes de rodar.
# =============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BANCO="${BANCO:-ecossistema_teste}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -d $BANCO"

echo "==> recriando o banco $BANCO em $PGHOST:$PGPORT"
psql -d postgres -q -c "drop database if exists $BANCO;"
psql -d postgres -q -c "create database $BANCO;"

echo "==> aplicando migrations"
for f in "$RAIZ"/db/migrations/*.sql; do
  echo "    - $(basename "$f")"
  $PSQL -f "$f"
done

echo "==> aplicando seed"
$PSQL -f "$RAIZ/db/seed.sql"

echo "==> rodando testes"
SAIDA=$(mktemp)
for f in "$RAIZ"/tests/*.sql; do
  echo ""
  echo "--- $(basename "$f") ---"
  if psql -v ON_ERROR_STOP=1 -q -d "$BANCO" -f "$f" > "$SAIDA" 2>&1; then
    grep -E "(NOTICE|^==)" "$SAIDA" | sed -E "s#^psql:[^ ]+ ##" || true
  else
    grep -E "(NOTICE|ERROR|^==)" "$SAIDA" || cat "$SAIDA"
    rm -f "$SAIDA"
    echo ""
    echo "==> FALHOU em $(basename "$f")"
    exit 1
  fi
done
rm -f "$SAIDA"

echo ""
echo "==> TUDO PASSOU"
