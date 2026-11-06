#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Locus requires Python 3.9 or later. Install Python 3 and try again."
  exit 1
fi
exec python3 run_locus.py "$@"
