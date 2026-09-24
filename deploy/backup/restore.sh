#!/bin/sh
# Restore a database backup. Run from the backup container:
#   docker compose run --rm -v /path/to/kosku-backup.key:/key:ro backup restore.sh db/daily/kosku-20261001.dump.age
# Stop the app first (docker compose stop app) so nothing writes during the restore.
set -eu
FILE="${1:?usage: restore.sh <remote path under BACKUP_REMOTE>}"
KEY="${AGE_KEY_FILE:-/key}"
rclone copyto "$BACKUP_REMOTE/$FILE" /tmp/restore.dump.age
age -d -i "$KEY" /tmp/restore.dump.age > /tmp/restore.dump
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" /tmp/restore.dump
rm -f /tmp/restore.dump /tmp/restore.dump.age
echo "Database dipulihkan dari $FILE. Jalankan: docker compose start app"
echo "Berkas dokumen: rclone copy \$BACKUP_REMOTE/files /data/files (dari container dengan volume appdata tanpa :ro)."
