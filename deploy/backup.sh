#!/bin/sh
# Daily backup of the database, secret key and uploaded videos.
# Add to crontab:  0 3 * * * /opt/bilimup/deploy/backup.sh
set -e
cd "$(dirname "$0")/.."
mkdir -p deploy/backups
STAMP=$(date +%Y-%m-%d)
docker compose exec -T app node -e "
const { DatabaseSync } = require('node:sqlite');
new DatabaseSync('/data/bilimup.db').exec(\"VACUUM INTO '/data/backup.db'\");
"
docker compose exec -T app tar -czf - -C /data backup.db secret.key videos > "deploy/backups/bilimup-$STAMP.tar.gz"
docker compose exec -T app rm -f /data/backup.db
# Keep the last 14 backups
ls -1t deploy/backups/bilimup-*.tar.gz | tail -n +15 | xargs -r rm --
echo "Backup saved: deploy/backups/bilimup-$STAMP.tar.gz"
