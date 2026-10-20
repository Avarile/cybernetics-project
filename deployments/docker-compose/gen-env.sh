#!/usr/bin/env bash
# Create `.env` from env.template with freshly generated secrets.
#   ./gen-env.sh [--url http://203.0.113.10 | https://projects.example.com] [--force]
# Without --url the site is http://localhost. With an https:// URL the host becomes the Caddy
# SITE_ADDRESS (automatic Let's Encrypt); with http:// it stays :80. Never overwrites an existing
# .env unless --force is given (that would orphan the database password).
set -euo pipefail
cd "$(dirname "$0")"

URL="http://localhost"; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:?--url needs a value}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -f .env ] && [ "$FORCE" != 1 ] && { echo ".env already exists, keeping it (use --force to replace)"; exit 0; }
[ -f env.template ] || { echo "env.template not found next to this script" >&2; exit 1; }

URL="${URL%/}"
case "$URL" in
  https://*) SITE="${URL#https://}" ;;
  http://*)  SITE=":80" ;;
  *) echo "--url must start with http:// or https://" >&2; exit 2 ;;
esac

gen() { openssl rand -hex "${1:-16}"; }   # hex only: safe inside URLs and shell

set_var() {  # set_var KEY VALUE  (values never contain '|' or newlines)
  sed -i "s|^$1=.*|$1=$2|" .env
}

cp env.template .env
chmod 600 .env
set_var WEB_URL "$URL"
set_var CORS_ALLOWED_ORIGINS "$URL"
set_var SITE_ADDRESS "$SITE"
set_var SECRET_KEY "$(gen 32)"
set_var LIVE_SERVER_SECRET_KEY "$(gen 32)"
set_var POSTGRES_PASSWORD "$(gen 16)"
set_var RABBITMQ_PASSWORD "$(gen 16)"
set_var AWS_ACCESS_KEY_ID "cyb$(gen 6)"
set_var AWS_SECRET_ACCESS_KEY "$(gen 20)"

echo "wrote $(pwd)/.env  (site: $URL)"
