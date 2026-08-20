#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R "${PUID}:${PGID}" /data
  exec gosu "${PUID}:${PGID}" "$@"
fi

exec "$@"
