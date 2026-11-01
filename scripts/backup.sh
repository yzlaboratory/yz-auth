#!/usr/bin/env bash
set -euo pipefail

: "${PGPASSWORD:?}"
: "${BACKUP_BUCKET:?}"
: "${AWS_REGION:?}"

create_backup() {
  local backup_file
  local backup_key
  backup_file=$(mktemp /tmp/yz-auth-backup.XXXXXX.dump)
  backup_key="yz-auth/$(date -u +%Y/%m/%d/%Y%m%dT%H%M%SZ.dump)"

  if ! pg_dump \
    --host="${POSTGRES_HOST:-postgres}" \
    --username="${POSTGRES_USER:-yz_auth}" \
    --dbname="${POSTGRES_DB:-yz_auth}" \
    --format=custom \
    --file="$backup_file"; then
    rm -f "$backup_file"
    return 1
  fi

  if ! aws s3 cp "$backup_file" "s3://${BACKUP_BUCKET}/${backup_key}" --only-show-errors; then
    rm -f "$backup_file"
    return 1
  fi

  rm -f "$backup_file"
}

while true; do
  if create_backup; then
    sleep 86400
  else
    sleep 300
  fi
done
