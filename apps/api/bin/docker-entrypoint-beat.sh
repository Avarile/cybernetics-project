#!/bin/bash
# Entrypoint for the Celery beat container: schedules periodic tasks defined in
# plane.celery once the database is reachable and migrations have been applied.
set -e

python manage.py wait_for_db
# Wait for migrations
python manage.py wait_for_migrations
# Run the processes
celery -A plane beat -l info