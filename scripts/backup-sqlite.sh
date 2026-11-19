#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: backup-sqlite.sh [--local-only] [--help]

Environment variables:
  DB_PATH          Path to source SQLite database (default: ./data/database.sqlite)
  BACKUP_DIR       Directory for local backups (default: ./backups)
  RETENTION_COUNT  Number of newest local backups to keep (default: 14)
  RCLONE_REMOTE    Destination rclone remote path, e.g. gdrive:clashbot-backups
                   (required unless --local-only is passed)
EOF
}

LOCAL_ONLY="${LOCAL_ONLY:-false}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --local-only)
            LOCAL_ONLY="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

DB_PATH="${DB_PATH:-./data/database.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_COUNT="${RETENTION_COUNT:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

if ! [[ "$RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]]; then
    echo "RETENTION_COUNT must be a positive integer, got: '$RETENTION_COUNT'" >&2
    exit 1
fi

for cmd in sqlite3 gzip; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Required command not found: $cmd" >&2
        exit 1
    fi
done

if [[ "$LOCAL_ONLY" != "true" ]]; then
    if ! command -v rclone >/dev/null 2>&1; then
        echo "Required command not found: rclone" >&2
        exit 1
    fi
    if [[ -z "$RCLONE_REMOTE" ]]; then
        echo "RCLONE_REMOTE is not set. Set RCLONE_REMOTE or pass --local-only." >&2
        exit 1
    fi
fi

if [[ ! -f "$DB_PATH" ]]; then
    echo "SQLite database not found: $DB_PATH" >&2
    exit 1
fi

mkdir -p "$BACKUP_DIR"

if command -v flock >/dev/null 2>&1; then
    exec 9>"$BACKUP_DIR/.backup.lock"
    if ! flock -n 9; then
        echo "Another backup process is already running." >&2
        exit 1
    fi
fi

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
FINAL_GZ="$BACKUP_DIR/clashbot_${TIMESTAMP}.sqlite.gz"
if [[ -e "$FINAL_GZ" ]]; then
    seq_num=1
    while [[ -e "$BACKUP_DIR/clashbot_${TIMESTAMP}_$(printf '%02d' "$seq_num").sqlite.gz" ]]; do
        seq_num=$((seq_num + 1))
    done
    FINAL_GZ="$BACKUP_DIR/clashbot_${TIMESTAMP}_$(printf '%02d' "$seq_num").sqlite.gz"
fi

TMP_SQLITE="$BACKUP_DIR/.tmp_clashbot_${TIMESTAMP}_$$.sqlite"
TMP_GZ="${TMP_SQLITE}.gz"

cleanup() {
    rm -f "$TMP_SQLITE" "$TMP_GZ"
}
trap cleanup EXIT

sqlite3 -cmd ".timeout 5000" "$DB_PATH" ".backup '$TMP_SQLITE'"

INTEGRITY="$(sqlite3 "$TMP_SQLITE" "PRAGMA integrity_check;" | tr -d '\r')"
if [[ "$INTEGRITY" != "ok" ]]; then
    echo "SQLite integrity check failed: $INTEGRITY" >&2
    exit 1
fi

gzip -c "$TMP_SQLITE" > "$TMP_GZ"
gzip -t "$TMP_GZ"
rm -f "$TMP_SQLITE"
mv "$TMP_GZ" "$FINAL_GZ"

echo "Created verified local backup: $FINAL_GZ"

if [[ "$LOCAL_ONLY" != "true" ]]; then
    rclone copy "$FINAL_GZ" "$RCLONE_REMOTE"
    echo "Uploaded backup to: $RCLONE_REMOTE"
fi

mapfile -t backups < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'clashbot_*.sqlite.gz' | LC_ALL=C sort -r
)

if (( ${#backups[@]} > RETENTION_COUNT )); then
    for old_file in "${backups[@]:RETENTION_COUNT}"; do
        rm -f "$old_file"
        echo "Removed old local backup: $old_file"
    done
fi
