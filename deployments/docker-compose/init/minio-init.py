"""One-shot MinIO bucket init for the docker-compose deployment.

Runs inside the backend image (boto3 is installed there). Waits for MinIO to answer,
creates AWS_S3_BUCKET_NAME if it is missing, and exits non-zero if it cannot, so
`depends_on: service_completed_successfully` actually blocks the API on a missing bucket.
Idempotent: safe to run on every `docker compose up`.
"""

import os
import sys
import time

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

ENDPOINT = os.environ["AWS_S3_ENDPOINT_URL"]
BUCKET = os.environ["AWS_S3_BUCKET_NAME"]
ATTEMPTS = int(os.environ.get("MINIO_INIT_ATTEMPTS", "60"))
DELAY = float(os.environ.get("MINIO_INIT_DELAY", "2"))


def main() -> int:
    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_REGION") or "us-east-1",
        config=Config(signature_version="s3v4", connect_timeout=3, read_timeout=5, retries={"max_attempts": 1}),
    )

    last_error = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            try:
                s3.head_bucket(Bucket=BUCKET)
                print(f"bucket '{BUCKET}' already exists")
            except ClientError as e:
                code = str(e.response["Error"]["Code"])
                if code not in ("404", "NoSuchBucket", "NotFound"):
                    raise
                s3.create_bucket(Bucket=BUCKET)
                print(f"bucket '{BUCKET}' created")
            return 0
        except (BotoCoreError, ClientError) as e:
            last_error = e
            print(f"[{attempt}/{ATTEMPTS}] MinIO not ready: {e}", flush=True)
            time.sleep(DELAY)

    print(f"giving up on bucket '{BUCKET}' at {ENDPOINT}: {last_error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
