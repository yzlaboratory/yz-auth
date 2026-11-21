#!/usr/bin/env bash
# Called by the host restic backup job before its snapshot.
# Writes a consistent PostgreSQL dump into ./backups so restic picks it up.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups

docker compose exec -T postgres pg_dump -U yz_auth -d yz_auth --clean --if-exists > backups/yz_auth.sql
find backups -type f -mtime +7 -delete
