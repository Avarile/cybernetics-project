# Deploying Cybernetics Projects with docker-compose

This runbook covers building the `cybernetics-project-*` images on this dev machine, copying
them with the compose file to a server, and running the whole stack there with
`docker compose`. No registry and no source tree are needed on the server. The k3s equivalent
is `deployments/local_dev/deploy-to-K3s`.

---

## 1. How it works

```
dev machine                                         server (any Linux with Docker)
───────────                                         ──────────────────────────────
build-and-export.sh
  docker build x6  ─▶ cybernetics-project-*:<tag>
  docker save | zstd ─▶ dist/cyb-<tag>/images.tar.zst
                        + docker-compose.yml, env.template, gen-env.sh, install.sh, init/
scp -r dist/cyb-<tag> ───────────────────────────▶ ~/cyb-<tag>/
                                                    ./install.sh --url http://<ip>
                                                      sha256 check ─▶ docker load
                                                      gen-env.sh (first run only) ─▶ .env
                                                      docker compose up -d
```

- **Only the six images you build are shipped:** `backend`, `web`, `space`, `admin`, `live`,
  `proxy`. Postgres, Valkey, RabbitMQ and MinIO are stock images that the server pulls from
  Docker Hub on the first `up`, so the server needs internet access (see
  [offline servers](#7-offline-servers)).
- **One compose file, two uses.** The root `docker-compose.yml` has both `build:` and a fixed
  `image: cybernetics-project-<c>:${RELEASE}` for each app service. The same file builds on a
  checkout and runs from loaded images on the server (`pull_policy: never`).
- **The images are domain-agnostic.** The web, admin and space builds use relative URLs (the
  `VITE_*_BASE_URL` build args stay empty), so one build works for any server. The address is set
  at runtime through `.env` (`WEB_URL`, `CORS_ALLOWED_ORIGINS`, `SITE_ADDRESS`). Do not pass those
  build args.
- **Tag format:** `release.<UTC timestamp>.1`, the same as the k3s runbook. All six images in a
  bundle share one tag.

### Services and start order

```
plane-db (pg_isready) ──┐
plane-redis (ping) ─────┼─▶ migrator (one-shot: manage.py migrate) ──┐
plane-mq (ping) ────────┤                                            ├─▶ api (healthy) ─▶ worker, beat-worker, live
plane-minio ────────────┴─▶ minio-init (one-shot: create bucket) ────┘
web, admin, space, live, api ─▶ proxy (Caddy, the only service with public ports)
```

### What is initialised, and by what

| What | By | Notes |
|---|---|---|
| Postgres user and database | the `postgres` image | From `POSTGRES_USER/PASSWORD/DB`, first start only. |
| Postgres extensions or roles | `init/db-init.sh` | Runs on first start only. Currently a no-op: the migrations need no extensions. |
| Database schema | `migrator` service | `manage.py migrate`. `api`, `worker` and `beat-worker` wait for it to finish successfully. |
| Instance record and config | API entrypoint | `register_instance`, `configure_instance`. Runs on every start. |
| MinIO bucket | `minio-init` service (`init/minio-init.py`) | Runs from the backend image. Retries until MinIO answers, creates the bucket if missing, and **fails the deploy** if it can't. The API waits for it. |
| First admin user | you | Not automated. Open `<WEB_URL>/god-mode/` after the first start. |

---

## 2. Prerequisites

Dev machine: Docker with BuildKit, `zstd`, `git`, `openssl` (for the server scripts, not needed
locally). Server: Docker Engine with the Compose v2 plugin, `zstd` (or use `--gzip`), and
**x86_64 Linux**. The images are built for this machine's architecture, and the build script prints
it for each image. An ARM server needs a `docker buildx` build with `--platform linux/arm64`.

Open ports on the server: 80 (and 443 if you use a domain with HTTPS).

---

## 3. Build and export (dev machine)

```bash
cd "$(git rev-parse --show-toplevel)"
deployments/docker-compose/build-and-export.sh
```

It warns about uncommitted changes in `apps/` or `packages/` (they are baked into the images),
builds all six images (logs go to a temp dir that is printed), exports them, and writes the
bundle to `dist/cyb-<tag>/` (`dist/` is git-ignored).

| Option | Effect |
|---|---|
| `--release TAG` | Use this tag instead of a new one. |
| `--skip-build` | Don't build. Export images already tagged `cybernetics-project-*:TAG`. All six must exist. |
| `--out DIR` | Write the bundle under `DIR` instead of `dist/`. |
| `--gzip` | Compress with gzip, for servers without `zstd`. |

The bundle:

```
cyb-<tag>/
├── docker-compose.yml     # copy of the repo-root file
├── env.template           # config template (no secrets)
├── gen-env.sh             # creates .env with random secrets
├── install.sh             # run on the server
├── init/                  # minio-init.py, db-init.sh
├── images.tar.zst         # the six images
├── RELEASE.txt            # tag, commit, build time, image list
└── SHA256SUMS
```

A rebuild reuses the Docker layer cache, so only changed apps rebuild, but the bundle always
contains all six images.

---

## 4. Install on the server

```bash
scp -r dist/cyb-<tag> <server>:~/
ssh <server>
cd ~/cyb-<tag>
./install.sh --url http://203.0.113.10            # plain HTTP on an IP
./install.sh --url https://projects.example.com   # domain, automatic Let's Encrypt
```

`install.sh` does, in order:

1. Verifies `SHA256SUMS`.
2. Runs `docker load` on the image archive.
3. Creates `.env` with random secrets, only if it doesn't exist (`gen-env.sh`). `--url` is only
   used for this step.
4. Writes `RELEASE=<tag>` into `.env`.
5. Runs `docker compose up -d --no-build`. The first run pulls the four stock images.
6. Waits until the API is healthy, which means the migrations and the bucket init have finished.

Then open the printed URL. On a fresh database, create the instance admin at `<url>/god-mode/`
first.

Notes on the address:

- `http://` URL: Caddy serves plain HTTP on `:80`. Session cookies are not marked secure.
- `https://` URL: the host becomes the Caddy `SITE_ADDRESS` and Let's Encrypt issues the
  certificate. Ports 80 and 443 must reach the server. Set `CERT_EMAIL="email you@example.com"`
  in `.env` and run `docker compose up -d proxy` to apply.
- Changing the address later: edit `WEB_URL`, `CORS_ALLOWED_ORIGINS` and `SITE_ADDRESS` in `.env`,
  then `docker compose up -d`.

### The MinIO console

Published on the server's loopback only (port 9090). Reach it through a tunnel:
`ssh -L 9090:127.0.0.1:9090 <server>` then open http://localhost:9090. The login is
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from `.env`.

---

## 5. Upgrade and rollback

Upgrade: build a new bundle, `scp` it, then on the server:

```bash
cp ~/cyb-<old-tag>/.env ~/cyb-<new-tag>/.env     # keep the secrets, or the database login breaks
cd ~/cyb-<new-tag> && ./install.sh
```

`install.sh` loads the new images, points `RELEASE` at them, and runs `up -d`. The `migrator`
runs first; the app containers are recreated afterwards (expect a short outage). Volumes are
never touched. Without the copied `.env`, a new one with new secrets would be generated, and
Postgres would reject the new password.

Rollback: old images stay loaded on the server. In the new folder's `.env` set
`RELEASE=<old-tag>` and run `docker compose up -d --no-build`. **Migrations are not reverted.** The
old backend must still work with the new schema. Additive migrations are fine.

Clean up old images now and then: `docker image ls 'cybernetics-project-*'`, then
`docker rmi` the tags you will never roll back to.

---

## 6. Operations

Run these inside the bundle folder on the server.

```bash
docker compose ps                           # status and health
docker compose logs -f api                  # API (also: worker, beat-worker, live, proxy)
docker compose logs migrator minio-init     # the one-shot init jobs
docker compose restart api worker beat-worker
docker compose down                         # stop; data stays in the volumes
docker compose down -v                      # DESTROYS database, uploads and queue data
```

Data lives in the named volumes `pgdata`, `uploads` (MinIO), `redisdata`, `rabbitmq_data`,
`proxy_data`/`proxy_config` (certificates). Back them up before upgrades you are unsure about:

```bash
docker compose exec -T plane-db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | zstd > pg-$(date +%F).sql.zst
```

(`set -a; . ./.env; set +a` first, to load the variables.)

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `RELEASE ... required` or `variable is not set` | `.env` missing or incomplete | Run `./gen-env.sh`, or compare with `env.template`. |
| `pull access denied for cybernetics-project-...` | The images weren't loaded | `zstd -dc images.tar.zst \| docker load`, then `docker compose up -d --no-build`. |
| `minio-init` exits 1 | MinIO unreachable, or the credentials differ from the existing volume | `docker compose logs minio-init plane-minio`. If you changed the MinIO credentials after the first start, the `uploads` volume keeps the old ones. |
| `api` never becomes healthy | Migration failed or the DB is unreachable | `docker compose logs migrator api`. |
| Postgres login fails after an upgrade | `.env` was regenerated, so the password differs from the existing volume | Restore the previous `.env`. |
| `exec format error` | Image architecture differs from the server | Rebuild with `docker buildx --platform`. |
| CORS errors in the browser | `WEB_URL` / `CORS_ALLOWED_ORIGINS` don't match the address in the browser | Fix `.env`, then `docker compose up -d`. |
| Uploads fail or return 403 | Bucket name mismatch between `.env` and the Caddy route | `AWS_S3_BUCKET_NAME` feeds both; keep it unchanged after the first start. |

---

## 7. Offline servers

By default the server pulls four stock images. For a server without internet, export them on the
dev machine and load them before `install.sh`:

```bash
docker pull postgres:15.7-alpine valkey/valkey:7.2.11-alpine rabbitmq:3.13.6-management-alpine minio/minio:RELEASE.2025-04-22T22-12-26Z
docker save postgres:15.7-alpine valkey/valkey:7.2.11-alpine rabbitmq:3.13.6-management-alpine \
  minio/minio:RELEASE.2025-04-22T22-12-26Z | zstd -T0 -3 > infra-images.tar.zst
# on the server: zstd -dc infra-images.tar.zst | docker load
```

The Caddy proxy image is built from `apps/proxy`, which needs internet only at build time (on the
dev machine).

---

## 8. Local use of the same compose file

For a dev check of the full stack, the repo-root `.env` is the dev-only one (it points at the shared
`platform-*` infra), so don't use it. Generate a separate env and pass it explicitly:

```bash
cd deployments/docker-compose && ./gen-env.sh --url http://localhost --force   # writes a git-ignored .env
sed -i 's|^INIT_DIR=.*|INIT_DIR=./deployments/docker-compose/init|; s|^RELEASE=.*|RELEASE=<tag of your local images>|' .env
cd ../..
docker compose --env-file deployments/docker-compose/.env -p cyb-smoke up -d   # builds if images are missing
```

Set `LISTEN_HTTP_PORT`, `LISTEN_HTTPS_PORT` and `MINIO_CONSOLE_PORT` in that env file if the
defaults clash with other things on your machine, and keep `-p cyb-smoke` so the stack stays
separate from your other containers. Never point it at the `plane_dev` database or the
shared infra.
