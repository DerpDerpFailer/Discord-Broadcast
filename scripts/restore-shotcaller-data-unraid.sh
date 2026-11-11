#!/usr/bin/env bash
# Restore one Shotcaller instance's data folder (config.json, written by /setup) on
# Unraid, from an Appdata Backup archive (default: the latest one) or from a folder.
# The target becomes an exact copy of the source (files missing from the source
# are removed); the current data is snapshotted first.
#
# Dry-run by default: nothing is changed unless --apply is given.
# Runs on the Unraid host as root; from the Mac, without installing anything:
#
#   ssh root@192.168.1.240 'bash -s -- --instance tsunami [options]' < scripts/restore-shotcaller-data-unraid.sh
#
# Options:
#   --instance NAME    tsunami | alliance (required) → stack/container shotcaller-<NAME>-bot
#   --backup NAME      Appdata Backup run to restore from (e.g. ab_20261115_040001)
#   --from-dir DIR     restore from a folder holding config.json instead
#                      (rollback snapshot, rescue backup...)
#   --apply            really restore (stop bot, snapshot, copy, chown, verify, start)
#   --data-dir DIR     target folder      (default: /mnt/user/appdata/shotcaller-<NAME>-bot/data)
#   --container NAME   bot container      (default: shotcaller-<NAME>-bot)
#   --image IMAGE      image used to validate the JSON (default: the container's image)
#   --backup-root DIR  Appdata Backup root (default: /mnt/user/documents/backup-appdata)
#   -h, --help         show this help
set -euo pipefail

INSTANCE=""
DATA_DIR=""
CONTAINER=""
BACKUP_ROOT="/mnt/user/documents/backup-appdata"
BACKUP=""
FROM_DIR=""
IMAGE=""
APPLY=0
OWNER="999:999"   # the image's "discord" user

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
usage() {
  cat <<'EOF'
Usage: ssh root@192.168.1.240 'bash -s -- --instance NAME [options]' < scripts/restore-shotcaller-data-unraid.sh
  --instance tsunami|alliance      required
  --backup NAME | --from-dir DIR   source (default: latest Appdata Backup run)
  --apply                          really restore (default: dry-run)
  --data-dir DIR  --container NAME  --image IMAGE  --backup-root DIR
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --instance)    INSTANCE="${2:?--instance needs a value}"; shift 2 ;;
    --backup)      BACKUP="${2:?--backup needs a value}"; shift 2 ;;
    --from-dir)    FROM_DIR="${2:?--from-dir needs a value}"; shift 2 ;;
    --data-dir)    DATA_DIR="${2:?--data-dir needs a value}"; shift 2 ;;
    --container)   CONTAINER="${2:?--container needs a value}"; shift 2 ;;
    --image)       IMAGE="${2:?--image needs a value}"; shift 2 ;;
    --backup-root) BACKUP_ROOT="${2:?--backup-root needs a value}"; shift 2 ;;
    --apply)       APPLY=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "unknown option: $1 (see --help)" ;;
  esac
done

case "$INSTANCE" in
  tsunami|alliance) ;;
  "") die "--instance is required (tsunami | alliance)" ;;
  *)  die "unknown instance: $INSTANCE (tsunami | alliance)" ;;
esac
DATA_DIR="${DATA_DIR:-/mnt/user/appdata/shotcaller-$INSTANCE-bot/data}"
CONTAINER="${CONTAINER:-shotcaller-$INSTANCE-bot}"

[ "$(id -u)" -eq 0 ] || die "must run as root on the Unraid host"
[ -z "$BACKUP" ] || [ -z "$FROM_DIR" ] || die "--backup and --from-dir are mutually exclusive"
command -v docker >/dev/null || die "docker not found"
command -v rsync >/dev/null || die "rsync not found"
log "Instance $INSTANCE: container $CONTAINER, data $DATA_DIR"

WORK="$(mktemp -d /tmp/shotcaller-restore.XXXXXX)"
STOPPED=0
SNAPSHOT=""
on_exit() {
  local rc=$?
  rm -rf "$WORK"
  if [ "$rc" -ne 0 ] && [ "$STOPPED" -eq 1 ]; then
    log "FAILED after stopping $CONTAINER: it is left stopped."
    [ -z "$SNAPSHOT" ] || log "Data as it was before the restore: $SNAPSHOT"
    log "Check $DATA_DIR, then: docker start $CONTAINER"
  fi
}
trap on_exit EXIT

# ── Resolve the source folder ────────────────────────────────────────────────
if [ -n "$FROM_DIR" ]; then
  [ -d "$FROM_DIR" ] || die "folder not found: $FROM_DIR"
  SRC="$(cd "$FROM_DIR" && pwd)"
  log "Source: folder $SRC"
else
  if [ -z "$BACKUP" ]; then
    # Latest run that actually contains an archive for this container.
    # ab_YYYYMMDD_HHMMSS sorts chronologically; the glob expands in ascending order.
    for run in "$BACKUP_ROOT"/ab_*; do
      [ -f "$run/$CONTAINER.tar.gz" ] && BACKUP="$(basename "$run")"
    done
    [ -n "$BACKUP" ] || die "no Appdata Backup run under $BACKUP_ROOT contains $CONTAINER.tar.gz"
  fi
  ARCHIVE="$BACKUP_ROOT/$BACKUP/$CONTAINER.tar.gz"
  [ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"
  log "Source: archive $ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$WORK"
  # The archive layout depends on the plugin: locate the config file wherever it is.
  mapfile -t dirs < <(find "$WORK" -type f -name 'config.json' -printf '%h\n' | sort -u)
  [ "${#dirs[@]}" -gt 0 ] || die "no config.json in $ARCHIVE"
  [ "${#dirs[@]}" -eq 1 ] || die "config.json found in several folders of the archive: ${dirs[*]}"
  SRC="${dirs[0]}"
  log "Data found in the archive at ${SRC#"$WORK"/}"
fi
[ -f "$SRC/config.json" ] || die "no config.json in $SRC"

# ── Validate the JSON with the bot's own image (Unraid has no node) ─────────
if [ -z "$IMAGE" ]; then
  IMAGE="$(docker inspect -f '{{.Config.Image}}' "$CONTAINER" 2>/dev/null)" \
    || die "container $CONTAINER not found; pass --image to validate the JSON"
fi
summary="$(docker run --rm --network none --user 0:0 -v "$SRC":/src:ro \
  --entrypoint node "$IMAGE" -e '
const fs = require("fs");
let c;
try { c = JSON.parse(fs.readFileSync("/src/config.json", "utf8")); }
catch (e) { console.error(`config.json: ${e.message}`); process.exit(1); }
if (typeof c !== "object" || c === null || Array.isArray(c)) { console.error("config.json: not a JSON object"); process.exit(1); }
console.log(`config.json OK (${Object.keys(c).length} top-level key(s))`);
')" || die "the source data is not valid"
log "Data valid: $summary"

# ── Plan ─────────────────────────────────────────────────────────────────────
mkdir -p "$WORK/empty"
target="$DATA_DIR"; [ -d "$target" ] || target="$WORK/empty"
plan="$(rsync -rlpt --delete --checksum --dry-run --itemize-changes "$SRC"/ "$target"/ | grep -v '^\.d' || true)"
changes="$(printf '%s' "$plan" | grep -c . || true)"
[ -z "$plan" ] || printf '%s\n' "$plan" | sed 's/^/  /' >&2

if [ "$APPLY" -eq 0 ]; then
  log "Dry-run: nothing changed ($changes change(s) planned). Re-run with --apply to restore."
  exit 0
fi
[ "$changes" -gt 0 ] || { log "Nothing to restore: target already matches the source."; exit 0; }

# ── Apply ────────────────────────────────────────────────────────────────────
was_running="$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)"
if [ "$was_running" = "true" ]; then
  log "Stopping $CONTAINER (an active broadcast is ended)"
  docker stop "$CONTAINER" >/dev/null
  STOPPED=1
fi

mkdir -p "$DATA_DIR"
SNAPSHOT="$DATA_DIR.before-restore-$(date '+%Y%m%d-%H%M%S')"
cp -a "$DATA_DIR" "$SNAPSHOT"
log "Current data saved to $SNAPSHOT"

rsync -rlpt --delete --checksum "$SRC"/ "$DATA_DIR"/
chown -R "$OWNER" "$DATA_DIR"
leftover="$(rsync -rlpt --delete --checksum --dry-run --itemize-changes "$SRC"/ "$DATA_DIR"/ | grep -v '^\.d' || true)"
[ -z "$leftover" ] || die "target differs from the source after the copy: $leftover"
log "Restored $changes change(s), owner $OWNER, checksums OK"

if [ "$was_running" = "true" ]; then
  log "Starting $CONTAINER"
  docker start "$CONTAINER" >/dev/null
  STOPPED=0
  sleep 8
  docker logs --tail 20 "$CONTAINER" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -vi token >&2 || true
else
  log "$CONTAINER was not running: left stopped"
fi
log "Done. Rollback: same command with --instance $INSTANCE --from-dir $SNAPSHOT --apply"
