#!/usr/bin/env bash
# =============================================================================
# Backup do banco.
#
#   ./scripts/backup.sh                 grava em backups/
#   DESTINO=/outro/lugar ./scripts/backup.sh
#
# Usa DATABASE_URL_ADMIN (usuário dono). O app_web não enxerga tudo por causa do
# RLS — um dump feito com ele sairia incompleto e, pior, sairia SEM ERRO.
#
# O dump inclui os documentos: eles moram em documento_conteudo, no próprio
# banco (ver migration 004). Quando o armazenamento virar S3/R2, este script
# passa a cobrir só metade, e o bucket precisa do próprio backup.
# =============================================================================
set -euo pipefail

URL="${DATABASE_URL_ADMIN:-}"
if [ -z "$URL" ]; then
  echo "Defina DATABASE_URL_ADMIN (usuário dono do banco)." >&2
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="${DESTINO:-$RAIZ/backups}"
RETENCAO_DIAS="${RETENCAO_DIAS:-14}"

mkdir -p "$DESTINO"
ARQUIVO="$DESTINO/ecossistema-$(date +%Y%m%d-%H%M%S).dump"

echo "==> gerando $ARQUIVO"
# -Fc: formato custom, comprimido e restaurável com pg_restore seletivo (dá para
# recuperar uma tabela só). O formato texto só permite tudo ou nada.
pg_dump "$URL" --format=custom --no-owner --no-privileges --file="$ARQUIVO"

echo "==> tamanho: $(du -h "$ARQUIVO" | cut -f1)"

# Um dump que não restaura não é backup. pg_restore --list lê o índice interno
# do arquivo e falha se ele estiver truncado ou corrompido — é a diferença entre
# "o comando não deu erro" e "o arquivo serve".
echo "==> conferindo o arquivo"
TABELAS="$(pg_restore --list "$ARQUIVO" | grep -c 'TABLE DATA' || true)"
if [ "$TABELAS" -lt 5 ]; then
  echo "FALHOU: o dump tem só $TABELAS tabelas com dados. Algo saiu errado." >&2
  exit 1
fi
echo "    $TABELAS tabelas com dados"

echo "==> apagando backups com mais de $RETENCAO_DIAS dias"
find "$DESTINO" -name 'ecossistema-*.dump' -mtime +"$RETENCAO_DIAS" -print -delete

echo ""
echo "==> backup concluído"
echo "    restaurar:  ./scripts/restaurar.sh $ARQUIVO"
