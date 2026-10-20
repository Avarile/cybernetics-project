#!/usr/bin/env bash
# Run on the SERVER, inside the bundle folder: verify, load the images and (re)start the stack.
#   ./install.sh [--url http://<ip> | https://<domain>]     (--url only matters on first install)
#
# First install: generates .env with random secrets (gen-env.sh). Upgrade: unpack the new bundle
# next to the old one, copy the old .env across, run this script. RELEASE in .env is updated and the
# migrator runs before the API restarts. Volumes (database, uploads) are never touched.
set -euo pipefail
cd "$(dirname "$0")"

URL_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL_ARGS=(--url "${2:?--url needs a value}"); shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 plugin not found" >&2; exit 1; }

echo "== verifying bundle"
sha256sum --quiet -c SHA256SUMS

RELEASE="$(sed -n 's/^release: //p' RELEASE.txt)"
ARCHIVE="$(sed -n 's/^archive: //p' RELEASE.txt)"
[ -n "$RELEASE" ] && [ -f "$ARCHIVE" ] || { echo "RELEASE.txt or $ARCHIVE missing" >&2; exit 1; }

echo "== loading images ($RELEASE)"
case "$ARCHIVE" in
  *.zst) command -v zstd >/dev/null || { echo "zstd not installed on this server (apt/dnf install zstd)" >&2; exit 1; }
         zstd -dc "$ARCHIVE" | docker load ;;
  *.gz)  gzip -dc "$ARCHIVE" | docker load ;;
esac

echo "== configuration"
./gen-env.sh "${URL_ARGS[@]}"
if grep -q '^RELEASE=' .env; then sed -i "s|^RELEASE=.*|RELEASE=$RELEASE|" .env; else echo "RELEASE=$RELEASE" >>.env; fi

echo "== starting (pulls postgres/valkey/rabbitmq/minio on first run)"
docker compose up -d --no-build --remove-orphans

echo "== waiting for the API to become healthy (migrations + bucket init run first)"
for _ in $(seq 1 90); do
  cid="$(docker compose ps -q api 2>/dev/null || true)"
  status="$( [ -n "$cid" ] && docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" || echo none )"
  [ "$status" = healthy ] && break
  sleep 5
done
docker compose ps
if [ "$status" != healthy ]; then
  echo "API not healthy yet. Check: docker compose logs migrator minio-init api" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a
echo
echo "up: $WEB_URL"
echo "first run on a fresh database: create the instance admin at $WEB_URL/god-mode/"
