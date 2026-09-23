#!/bin/bash
# Convenience entry point for running the API tests from apps/api.
# All arguments are forwarded unchanged to tests/run_tests.sh.

# This is a simple wrapper script that calls the main test runner in the tests directory
exec tests/run_tests.sh "$@" 