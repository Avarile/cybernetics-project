#!/bin/bash
# Run a command on the HOST (no container) against the shared `platform` infra.
#
# apps/api/.env is container-side: it uses the `backbone` aliases plane-db / plane-redis /
# plane-mq, which only resolve inside docker. Load it, then point those at the loopback ports
# the infra publishes. MinIO already uses the host LAN IP, so it works from both sides as-is.
#
#   ./bin/run-host.sh python manage.py migrate
#   ./bin/run-host.sh python manage.py runserver 8000
#   ./bin/run-host.sh celery -A plane worker -l info
set -e
cd "$(dirname "$0")/.."

set -a
. ./.env
set +a

# Rewrite the docker-internal hostnames in the connection URLs to the host-published ports.
export DATABASE_URL="${DATABASE_URL/@plane-db:5432/@127.0.0.1:30898}"
export REDIS_URL="${REDIS_URL/@plane-redis:6379/@127.0.0.1:30490}"
export AMQP_URL="${AMQP_URL/@plane-mq:5672/@127.0.0.1:30672}"
export POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=30898
export REDIS_HOST=127.0.0.1 REDIS_PORT=30490
export RABBITMQ_HOST=127.0.0.1 RABBITMQ_PORT=30672

# manage.py and celery both default to plane.settings.production.
export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-plane.settings.local}"
export PATH="$PWD/.venv/bin:$PATH"

exec "$@"
