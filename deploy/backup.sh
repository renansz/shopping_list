#!/bin/sh
# Backup do banco SQLite sem parar o servico.
#
#   ./deploy/backup.sh [destino]
#
# Sugestao de cron (todo dia as 3h):
#   0 3 * * * cd /opt/lista-de-compras && ./deploy/backup.sh /var/backups/lista
#
# Com Docker:
#   docker compose exec lista node tools/backup.mjs /data/backups
set -eu
cd "$(dirname "$0")/.."
exec node tools/backup.mjs "$@"
