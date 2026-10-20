#!/bin/sh
# Postgres first-start hook, mounted at /docker-entrypoint-initdb.d/10-db-init.sh.
#
# The postgres image has already created POSTGRES_USER / POSTGRES_DB by the time this runs, and it
# only runs when the data volume is EMPTY. The schema itself is created by the `migrator` service
# (Django migrations), not here. No Postgres extensions are required by the current migrations;
# add any future ones below so a fresh server gets them before the first migration.
set -eu

echo "db-init: database '$POSTGRES_DB' ready for migrations"

# psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
#   -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
