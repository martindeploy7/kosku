#!/bin/sh
# Encrypted, off-site backups.
#   db/hourly   every hour, kept 48 h
#   db/daily    one per day (first run after 03:00 WIB = 20:00 UTC), kept 35 days
#   db/monthly  first day of the month, kept ~13 months
#   files/      uploaded documents (write-once, never deleted by the app)
# Dumps are encrypted with the age public key BEFORE they leave the server;
# the private key lives with the owner, not on the VPS.
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP="/tmp/kosku-$STAMP.dump.age"
R="$BACKUP_REMOTE"

pg_dump --format=custom --no-owner "$DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" > "$TMP"
SIZE=$(wc -c < "$TMP")
if [ "$SIZE" -lt 1024 ]; then
  echo "[backup] dump suspiciously small ($SIZE bytes) — aborting"; rm -f "$TMP"; exit 1
fi

rclone copyto "$TMP" "$R/db/hourly/kosku-$STAMP.dump.age"
DAY=$(date -u +%Y%m%d)
if [ "$(date -u +%H)" -ge 20 ] && ! rclone lsf "$R/db/daily/" 2>/dev/null | grep -q "kosku-$DAY"; then
  rclone copyto "$TMP" "$R/db/daily/kosku-$DAY.dump.age"
fi
if [ "$(date -u +%d)" = "01" ] && ! rclone lsf "$R/db/monthly/" 2>/dev/null | grep -q "kosku-$(date -u +%Y%m)"; then
  rclone copyto "$TMP" "$R/db/monthly/kosku-$(date -u +%Y%m).dump.age"
fi
rm -f "$TMP"

rclone delete --min-age 48h "$R/db/hourly" || true
rclone delete --min-age 35d "$R/db/daily" || true
rclone delete --min-age 400d "$R/db/monthly" || true

# Local document storage (STORAGE_DRIVER=local). With S3/R2 storage the files are already off-site.
if [ -d /data/files ]; then
  rclone copy /data/files "$R/files" --transfers 4
fi

[ -n "${BACKUP_HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "$BACKUP_HEALTHCHECK_URL" > /dev/null || true
echo "[backup] ok $STAMP ($SIZE bytes)"
