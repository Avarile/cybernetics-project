#!/bin/bash
# Entrypoint for the one-shot migrator container: waits for the database, then
# applies Django migrations. An optional first argument is forwarded to both commands.
set -e

python manage.py wait_for_db $1

python manage.py migrate $1