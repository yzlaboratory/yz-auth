#!/usr/bin/env bash
# Called by the host restic backup job before its snapshot.
# Writes a consistent PostgreSQL dump into ./backups so restic picks it up.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups

container=$(docker ps -q \
  --filter label=com.docker.compose.project=yz-auth \
  --filter label=com.docker.compose.service=postgres | head -n1)
[[ -n $container ]] || { echo "yz-auth postgres container is not running" >&2; exit 1; }

docker exec "$container" pg_dump -U yz_auth -d yz_auth --clean --if-exists > backups/yz_auth.sql
find backups -type f -mtime +7 -delete
