#!/bin/sh
# Entrypoint script to create PocketBase superuser at runtime
set -e

: "${PB_SUPERUSER_EMAIL:=admin@localhost.com}"
: "${PB_SUPERUSER_PASSWORD:=adminpassword}"

if [ ! -f /pb/data/superuser_created ]; then
  /pb/pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" && \
  touch /pb/data/superuser_created
fi

exec /pb/pocketbase serve --http=0.0.0.0:8080
