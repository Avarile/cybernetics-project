#!/usr/bin/env bash
# Build the six Cybernetics Projects images and export a self-contained bundle to scp to a server.
#   deployments/docker-compose/build-and-export.sh [--release TAG] [--skip-build] [--out DIR] [--gzip]
#
#   --release TAG  use this tag instead of a new release.<UTC>.1 (images must exist with --skip-build)
#   --skip-build   do not build; export images that are already tagged cybernetics-project-*:TAG
#   --out DIR      output parent directory (default: dist/ in the repo, gitignored)
#   --gzip         compress with gzip instead of zstd (for servers without zstd)
#
# Output: <out>/cyb-<TAG>/  (docker-compose.yml, env.template, gen-env.sh, install.sh, init/,
#         images.tar.zst, SHA256SUMS, RELEASE.txt). Only the six custom images are exported;
#         postgres/valkey/rabbitmq/minio are pulled from Docker Hub by the server.
set -euo pipefail

REPO="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
HERE="$REPO/deployments/docker-compose"
cd "$REPO"

TAG="release.$(date -u +%Y-%m-%dT%H-%M-%SZ).1"; SKIP_BUILD=0; OUT="$REPO/dist"; COMP=zstd
while [ $# -gt 0 ]; do
  case "$1" in
    --release) TAG="${2:?--release needs a tag}"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    --gzip) COMP=gzip; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

COMPONENTS="backend web space admin live proxy"
dockerfile_of() { case "$1" in backend) echo apps/api/Dockerfile.api;; web) echo apps/web/Dockerfile.web;;
  space) echo apps/space/Dockerfile.space;; admin) echo apps/admin/Dockerfile.admin;;
  live) echo apps/live/Dockerfile.live;; proxy) echo apps/proxy/Dockerfile.ce;; esac; }
context_of() { case "$1" in backend) echo apps/api;; proxy) echo apps/proxy;; *) echo .;; esac; }

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
[ "$COMP" = zstd ] && ! command -v zstd >/dev/null && { echo "zstd not found (install it or use --gzip)" >&2; exit 1; }
COMMIT="$(git rev-parse --short HEAD)"
if [ -n "$(git status --short -- apps packages | grep -v '^??' || true)" ]; then
  echo "WARNING: uncommitted changes in apps/ or packages/ will be baked into the images"
fi

IMAGES=""
for c in $COMPONENTS; do IMAGES="$IMAGES cybernetics-project-$c:$TAG"; done

if [ "$SKIP_BUILD" = 0 ]; then
  LOGDIR="$(mktemp -d)"
  for c in $COMPONENTS; do
    echo "== building $c -> cybernetics-project-$c:$TAG  (log: $LOGDIR/$c.log)"
    docker build -f "$(dockerfile_of "$c")" -t "cybernetics-project-$c:$TAG" \
      --label "org.opencontainers.image.revision=$COMMIT" "$(context_of "$c")" >"$LOGDIR/$c.log" 2>&1 \
      || { echo "BUILD FAILED: $c"; tail -25 "$LOGDIR/$c.log"; exit 1; }
  done
fi

for i in $IMAGES; do
  docker image inspect "$i" >/dev/null 2>&1 || { echo "missing image: $i" >&2; exit 1; }
  # The root compose file builds these on a dev machine; a bundle must carry linux/amd64 images.
  arch="$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$i")"
  echo "   $i  ($arch)"
done

BUNDLE="$OUT/cyb-$TAG"
rm -rf "$BUNDLE"; mkdir -p "$BUNDLE/init"
cp "$REPO/docker-compose.yml" "$BUNDLE/docker-compose.yml"
cp "$HERE/env.template" "$HERE/gen-env.sh" "$HERE/install.sh" "$BUNDLE/"
cp "$HERE/init/"* "$BUNDLE/init/"
chmod +x "$BUNDLE/gen-env.sh" "$BUNDLE/install.sh" "$BUNDLE/init/db-init.sh"

if [ "$COMP" = zstd ]; then ARCHIVE=images.tar.zst; else ARCHIVE=images.tar.gz; fi
echo "== exporting images -> $ARCHIVE"
# shellcheck disable=SC2086
if [ "$COMP" = zstd ]; then docker save $IMAGES | zstd -T0 -3 -q -o "$BUNDLE/$ARCHIVE"
else docker save $IMAGES | gzip -c >"$BUNDLE/$ARCHIVE"; fi

{ echo "release: $TAG"; echo "commit: $COMMIT"; echo "built: $(date -u +%FT%TZ)"; echo "archive: $ARCHIVE"; echo "images:";
  for i in $IMAGES; do echo "  $i"; done; } >"$BUNDLE/RELEASE.txt"
(cd "$BUNDLE" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)

echo
echo "bundle: $BUNDLE  ($(du -sh "$BUNDLE" | cut -f1))"
echo "ship:   scp -r $BUNDLE <server>:~/    then on the server:  cd ~/cyb-$TAG && ./install.sh --url http://<ip-or-domain>"
