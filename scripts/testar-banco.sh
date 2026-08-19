#!/usr/bin/env bash
# =============================================================================
# Recria um banco descartável, aplica as migrations, o seed e roda os testes.
#
#   ./scripts/testar-banco.sh
#
# Variáveis (com valores padrão para o Supabase local):
#   PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres
#   BANCO=ecossistema_teste  STUB=1  (STUB=1 cria auth.uid() falso; use 0 no Supabase)
# =============================================================================
set -euo pipefail

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-54322}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
BANCO="${BANCO:-ecossistema_teste}"
STUB="${STUB:-1}"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q -d $BANCO"

echo "==> recriando o banco $BANCO em $PGHOST:$PGPORT"
psql -d postgres -q -c "drop database if exists $BANCO;" 
psql -d postgres -q -c "create database $BANCO;"

if [ "$STUB" = "1" ]; then
  echo "==> aplicando o stub de auth.uid() (Postgres comum)"
  $PSQL -f "$RAIZ/scripts/00-stub-auth-local.sql"
fi

echo "==> aplicando migrations"
for f in "$RAIZ"/supabase/migrations/*.sql; do
  echo "    - $(basename "$f")"
  $PSQL -f "$f"
done

echo "==> aplicando seed"
$PSQL -f "$RAIZ/supabase/seed.sql"

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
