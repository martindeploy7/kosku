#!/bin/sh
# Runs backup.sh every hour (at minute 17, off the top of the hour).
set -eu
: "${BACKUP_REMOTE:?set BACKUP_REMOTE, e.g. r2:kosku-backup}"
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (age public key)}"
echo "17 * * * * /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "[backup] first run now, then hourly"
/usr/local/bin/backup.sh || echo "[backup] first run failed — will retry on schedule"
exec crond -f -l 8
