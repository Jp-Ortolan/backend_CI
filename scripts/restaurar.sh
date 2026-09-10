#!/usr/bin/env bash
# =============================================================================
# Restaura um backup.
#
#   ./scripts/restaurar.sh backups/ecossistema-20260910-120000.dump
#
# Recusa rodar contra URL que não pareça local, a menos que FORCAR=1. O restore
# APAGA o banco antes de recriar — fazer isso em produção por engano é o tipo de
# acidente que não tem desfazer.
#
# Este script é a metade que costuma faltar: backup que nunca foi restaurado é
# esperança, não backup. Rodar isto uma vez em banco local, com um dump de
# homologação, é o que transforma um no outro.
# =============================================================================
set -euo pipefail

ARQUIVO="${1:-}"
if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  echo "Uso: ./scripts/restaurar.sh <arquivo.dump>" >&2
  exit 1
fi

URL="${DATABASE_URL_ADMIN:-}"
if [ -z "$URL" ]; then
  echo "Defina DATABASE_URL_ADMIN." >&2
  exit 1
fi

if [[ "$URL" != *localhost* && "$URL" != *127.0.0.1* && "${FORCAR:-0}" != "1" ]]; then
  echo "Esta URL não parece local. O restore APAGA o banco antes de recriar." >&2
  echo "Se tem certeza, rode com FORCAR=1." >&2
  exit 1
fi

echo "==> restaurando $ARQUIVO"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$URL" "$ARQUIVO"

echo ""
echo "==> conferindo o que voltou"
psql "$URL" -tAc "select 'instituicoes: ' || count(*) from instituicao"
psql "$URL" -tAc "select 'representantes: ' || count(*) from pessoa"
psql "$URL" -tAc "select 'reunioes: '     || count(*) from reuniao"
psql "$URL" -tAc "select 'presencas: '    || count(*) from presenca"
psql "$URL" -tAc "select 'documentos: '   || count(*) from documento"
psql "$URL" -tAc "select 'conteudo de documentos: ' || count(*) from documento_conteudo"

echo ""
echo "==> restaurado. Confira os números acima antes de considerar válido."
echo "    Lembre: o papel app_web e a senha dele NÃO vêm no dump (--no-owner)."
echo "    Depois de restaurar em ambiente novo, rode:"
echo "      alter role app_web login password '<senha>';"
