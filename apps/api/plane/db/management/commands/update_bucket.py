# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Management command ``update_bucket``: audit and update the S3/MinIO bucket policy.

Checks that the configured access key can list/get/put objects and set bucket
policies. If so, applies a policy that keeps every *currently existing* object
publicly readable (legacy public assets) while new objects stay private.
Otherwise writes the policy to ``permissions.json`` for a manual update.
"""

# Python imports
import os
import boto3
from botocore.exceptions import ClientError
import json

# Django imports
from django.core.management import BaseCommand


class Command(BaseCommand):
    """Verify bucket permissions and grant public read on existing objects."""

    help = "Create the default bucket for the instance"

    def get_s3_client(self):
        """Return a boto3 S3 client configured from ``AWS_*`` environment variables."""
        s3_client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("AWS_S3_ENDPOINT_URL"),  # MinIO endpoint
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),  # MinIO access key
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),  # MinIO secret key
            region_name=os.environ.get("AWS_REGION"),  # MinIO region
            config=boto3.session.Config(signature_version="s3v4"),
        )
        return s3_client

    # Check if the access key has the required permissions
    def check_s3_permissions(self, bucket_name):
        """Probe each required S3 action and return a ``{action: bool}`` map.

        Side effects: uploads/deletes a ``test_permission_check.txt`` object and
        overwrites the bucket policy with a public-read-all policy while testing.
        """
        s3_client = self.get_s3_client()
        permissions = {
            "s3:GetObject": False,
            "s3:ListBucket": False,
            "s3:PutBucketPolicy": False,
            "s3:PutObject": False,
        }

        # 1. Test s3:ListBucket (attempt to list the bucket contents)
        try:
            s3_client.list_objects_v2(Bucket=bucket_name)
            permissions["s3:ListBucket"] = True
        except ClientError as e:
            if e.response["Error"]["Code"] == "AccessDenied":
                self.stdout.write("ListBucket permission denied.")
            else:
                self.stdout.write(f"Error in ListBucket: {e}")

        # 2. Test s3:GetObject (attempt to get a specific object)
        try:
            response = s3_client.list_objects_v2(Bucket=bucket_name)
            if "Contents" in response:
                test_object_key = response["Contents"][0]["Key"]
                s3_client.get_object(Bucket=bucket_name, Key=test_object_key)
                permissions["s3:GetObject"] = True
        except ClientError as e:
            if e.response["Error"]["Code"] == "AccessDenied":
                self.stdout.write("GetObject permission denied.")
            else:
                self.stdout.write(f"Error in GetObject: {e}")

        # 3. Test s3:PutObject (attempt to upload an object)
        try:
            s3_client.put_object(Bucket=bucket_name, Key="test_permission_check.txt", Body=b"Test")
            permissions["s3:PutObject"] = True
            # Clean up
        except ClientError as e:
            if e.response["Error"]["Code"] == "AccessDenied":
                self.stdout.write("PutObject permission denied.")
            else:
                self.stdout.write(f"Error in PutObject: {e}")

        # Clean up
        try:
            s3_client.delete_object(Bucket=bucket_name, Key="test_permission_check.txt")
        except ClientError:
            self.stdout.write("Couldn't delete test object")

        # 4. Test s3:PutBucketPolicy (attempt to put a bucket policy)
        try:
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": "*",
                        "Action": "s3:GetObject",
                        "Resource": f"arn:aws:s3:::{bucket_name}/*",
                    }
                ],
            }
            s3_client.put_bucket_policy(Bucket=bucket_name, Policy=json.dumps(policy))
            permissions["s3:PutBucketPolicy"] = True
        except ClientError as e:
            if e.response["Error"]["Code"] == "AccessDenied":
                self.stdout.write("PutBucketPolicy permission denied.")
            else:
                self.stdout.write(f"Error in PutBucketPolicy: {e}")

        return permissions

    def generate_bucket_policy(self, bucket_name):
        """Build a policy granting public ``s3:GetObject`` on each object currently in the bucket.

        Only the first page (up to 1000 keys) of ``list_objects_v2`` is included.
        """
        s3_client = self.get_s3_client()
        response = s3_client.list_objects_v2(Bucket=bucket_name)
        public_object_resource = []
        if "Contents" in response:
            for obj in response["Contents"]:
                object_key = obj["Key"]
                public_object_resource.append(f"arn:aws:s3:::{bucket_name}/{object_key}")
        bucket_policy = {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Effect": "Allow",
                    "Principal": "*",
                    "Action": "s3:GetObject",
                    "Resource": public_object_resource,
                }
            ],
        }
        return bucket_policy

    def make_objects_public(self, bucket_name):
        """Apply the per-object public-read policy generated by ``generate_bucket_policy``."""
        # Initialize S3 client
        s3_client = self.get_s3_client()
        # Get the bucket policy
        bucket_policy = self.generate_bucket_policy(bucket_name)
        # Apply the policy to the bucket
        s3_client.put_bucket_policy(Bucket=bucket_name, Policy=json.dumps(bucket_policy))
        # Print a success message
        self.stdout.write("Bucket is private, but existing objects remain public.")
        return

    def handle(self, *args, **options):
        """Check the bucket, test permissions, and apply or export the bucket policy."""
        # Create a session using the credentials from Django settings

        # Check if the bucket exists
        s3_client = self.get_s3_client()
        # Get the bucket name from the environment
        bucket_name = os.environ.get("AWS_S3_BUCKET_NAME")

        if not bucket_name:
            self.stdout.write(self.style.ERROR("Please set the AWS_S3_BUCKET_NAME environment variable."))
            return

        self.stdout.write(self.style.NOTICE("Checking bucket..."))
        # Check if the bucket exists
        try:
            s3_client.head_bucket(Bucket=bucket_name)
        except ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code == "404":
                self.stdout.write(self.style.ERROR(f"Bucket '{bucket_name}' does not exist."))
                return
            else:
                self.stdout.write(f"Error: {e}")
        # If the bucket exists, print a success message
        self.stdout.write(self.style.SUCCESS(f"Bucket '{bucket_name}' exists."))

        try:
            # Check the permissions of the access key
            permissions = self.check_s3_permissions(bucket_name)
        except ClientError as e:
            self.stdout.write(f"Error: {e}")
        except Exception as e:
            self.stdout.write(f"Error: {e}")
        # If the access key has the required permissions
        # (if the permission check itself failed, `permissions` is unbound and the
        # NameError is swallowed below, falling through to writing permissions.json)
        try:
            if all(permissions.values()):
                self.stdout.write(self.style.SUCCESS("Access key has the required permissions."))
                # Making the existing objects public
                self.make_objects_public(bucket_name)
                return
        except Exception as e:
            self.stdout.write(f"Error: {e}")

        # write the bucket policy to a file
        self.stdout.write(self.style.WARNING("Generating permissions.json for manual bucket policy update."))
        try:
            # Writing to a file
            with open("permissions.json", "w") as f:
                f.write(json.dumps(self.generate_bucket_policy(bucket_name)))
            self.stdout.write(self.style.WARNING("Permissions have been written to permissions.json."))
            return
        except IOError as e:
            self.stdout.write(f"Error writing permissions.json: {e}")
            return
