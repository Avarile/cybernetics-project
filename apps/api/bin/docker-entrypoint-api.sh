#!/bin/bash
# Production entrypoint for the API container (used by Dockerfile.api).
# Waits for Postgres and migrations, registers/configures the instance, ensures the
# storage bucket exists, clears cache, collects static files, then execs gunicorn
# with uvicorn workers serving the ASGI app (plane.asgi).
set -e
python manage.py wait_for_db
# Wait for migrations
python manage.py wait_for_migrations

# Create the default bucket
#!/bin/bash

# Collect system information
# The machine signature is a hash of host details; register_instance uses it to
# identify this installation.
HOSTNAME=$(hostname)
MAC_ADDRESS=$(ip link show | awk '/ether/ {print $2}' | head -n 1)
CPU_INFO=$(cat /proc/cpuinfo)
MEMORY_INFO=$(free -h)
DISK_INFO=$(df -h)

# Concatenate information and compute SHA-256 hash
SIGNATURE=$(echo "$HOSTNAME$MAC_ADDRESS$CPU_INFO$MEMORY_INFO$DISK_INFO" | sha256sum | awk '{print $1}')

# Export the variables
export MACHINE_SIGNATURE=$SIGNATURE

# Register instance
python manage.py register_instance "$MACHINE_SIGNATURE"

# Load the configuration variable
python manage.py configure_instance

# Create the default bucket
python manage.py create_bucket

# Clear Cache before starting to remove stale values
python manage.py clear_cache

# Collect static files
python manage.py collectstatic --noinput

# --max-requests + jitter recycles workers periodically to bound memory growth;
# GUNICORN_WORKERS must be set in the environment.
exec gunicorn -w "$GUNICORN_WORKERS" -k uvicorn.workers.UvicornWorker plane.asgi:application --bind 0.0.0.0:"${PORT:-8000}" --max-requests 1200 --max-requests-jitter 1000 --access-logfile -
