#!/bin/bash
# Entrypoint for the Celery worker container: runs background tasks (emails, webhooks,
# issue activity, exports, etc.) once the database and migrations are ready.
set -e

python manage.py wait_for_db
# Wait for migrations
python manage.py wait_for_migrations
# Run the processes
celery -A plane worker -l info