# Shared settings and helpers for scripts/deploy.sh and scripts/launch.sh. Source it; do not run it.
# shellcheck shell=bash

APP_DIR="${APP_DIR:-/opt/hyper-clock}"
ENV_DIR="${ENV_DIR:-/etc/hyper-clock}"
RUN_USER="${RUN_USER:-hyperclock}"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REQUIRED_NODE_MAJOR=24
MIN_SECRET=32
WEB_UNITS=(hyper-clock-back-stage.service hyper-clock-watch-face.service)
KIOSK_UNIT=hyper-clock-kiosk.service
DAEMON_UNIT=q775-sensor-daemon.service

# Prints the comment block under the shebang of the calling script, then its option list.
usage_header() {
  sed -n '2,/^set -euo/p' "$1" | grep '^#' | sed 's/^# \{0,1\}//'
}

# ── output helpers ──────────────────────────────────────────────────────────
if [[ -t 1 ]]; then BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; AMBER=$'\e[33m'; RESET=$'\e[0m'; else BOLD=""; DIM=""; RED=""; GREEN=""; AMBER=""; RESET=""; fi
step() { printf '\n%s▸ %s%s\n' "$BOLD" "$*" "$RESET"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$AMBER" "$RESET" "$*"; }
fail() { printf '  %s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }
info() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }

as_user() { sudo -u "$RUN_USER" -H "$@"; }

# Reads KEY from a dotenv file without sourcing it (values may contain shell metacharacters).
env_value() {
  local file="$1" key="$2"
  [[ -r "$file" ]] || return 0
  { grep -E "^[[:space:]]*${key}=" "$file" || true; } | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/\r$//'
}

wait_for() {
  local name="$1" url="$2" tries="${3:-40}"
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then ok "$name healthy ($url)"; return 0; fi
    sleep 1
  done
  return 1
}

# Path of a module's standalone server.js, or nothing when it was never built.
# outputFileTracingRoot is the repository root, so Next nests the server under the package name.
standalone_server() {
  local dir="$APP_DIR/$1" candidate
  for candidate in "$dir/.next/standalone/$1/server.js" "$dir/.next/standalone/server.js"; do
    [[ -f "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}

# ── preflight shared by deploy and launch ───────────────────────────────────
require_root_and_app_dir() {
  [[ ${EUID} -eq 0 ]] || fail "Run with sudo (systemd units and $APP_DIR need root)"
  # deploy.sh rsyncs with --delete into APP_DIR, so refuse anything that is not a dedicated application directory.
  [[ "$APP_DIR" == /* ]] || fail "APP_DIR must be an absolute path (got '$APP_DIR')"
  case "${APP_DIR%/}" in
    ""|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var) fail "APP_DIR '$APP_DIR' is a system directory; use a dedicated one such as /opt/hyper-clock" ;;
  esac
  command -v systemctl >/dev/null || fail "systemd is required"
  command -v curl >/dev/null || fail "curl is not installed"
}

# check_secrets BACK_ENV FACE_ENV [KIOSK_ENV]
# KIOSK_ENV is where back-stage's effective kiosk secret lives (docker compose injects it from the root .env).
check_secrets() {
  local back="$1" face="$2" kiosk_file="${3:-$1}"
  local ha_url ha_token session kiosk face_kiosk
  ha_url="$(env_value "$back" HA_URL)"
  ha_token="$(env_value "$back" HA_TOKEN)"
  session="$(env_value "$back" SESSION_SECRET)"
  kiosk="$(env_value "$kiosk_file" KIOSK_SHARED_SECRET)"
  face_kiosk="$(env_value "$face" KIOSK_SHARED_SECRET)"

  [[ -n "$ha_url" ]] || fail "HA_URL missing in $back"
  [[ -n "$ha_token" && "$ha_token" != replace-* ]] || fail "HA_TOKEN missing or still the placeholder in $back"
  (( ${#session} >= MIN_SECRET )) && [[ "$session" != replace-* ]] || fail "SESSION_SECRET must be ≥ $MIN_SECRET random characters ($back)"
  (( ${#kiosk} >= MIN_SECRET )) && [[ "$kiosk" != replace-* ]] || fail "KIOSK_SHARED_SECRET must be ≥ $MIN_SECRET random characters ($kiosk_file)"
  [[ "$session" != "$kiosk" ]] || fail "SESSION_SECRET and KIOSK_SHARED_SECRET must be different (generate each with: openssl rand -hex 32)"
  [[ "$kiosk" == "$face_kiosk" ]] || fail "KIOSK_SHARED_SECRET differs between $kiosk_file and $face"
  # The value shipped with the original repository is sha256("a") repeated — publicly guessable.
  [[ "$session" != ca978112ca1bbdcafac231b39a23dc4d* && "$kiosk" != ca978112ca1bbdcafac231b39a23dc4d* ]] || fail "Secrets are the known sample value; regenerate them with openssl rand -hex 32"
  ok "Secrets present, long enough, distinct and matching between services"
  [[ -n "$(env_value "$back" BOOTSTRAP_ADMIN_PASSWORD)" ]] && warn "BOOTSTRAP_ADMIN_PASSWORD is set, so it is $(env_value "$back" BOOTSTRAP_ADMIN_USERNAME)'s password; remove it to manage that account in the UI"
  local method
  method="$(env_value "$back" AUTH_METHOD | tr '[:upper:]' '[:lower:]')"
  case "${method:-password}" in
    password|totp) ok "Sign-in method: ${method:-password}" ;;
    *) warn "AUTH_METHOD='$method' is not password or totp; back-stage falls back to password" ;;
  esac
  local harva_url harva_keys
  harva_url="$(env_value "$back" HARVA_URL)"
  harva_keys="$(env_value "$back" HARVA_API_KEYS)"
  if [[ -n "$harva_url" && -z "$harva_keys" ]]; then
    warn "HARVA_URL is set but HARVA_API_KEYS is empty; the BTC cards stay hidden"
  elif [[ -n "$harva_url" ]]; then
    local code
    code="$(curl -s -o /dev/null -m 4 -w '%{http_code}' -H "Authorization: Bearer ${harva_keys%%,*}" "${harva_url%/}/api/ha/state" || true)"
    case "$code" in
      200) ok "BTC-HARVA reachable with the first API key ($harva_url)" ;;
      401|403) warn "BTC-HARVA at $harva_url refused the first API key (HTTP $code)" ;;
      *) warn "BTC-HARVA at $harva_url not reachable from this machine (HTTP ${code:-none}); the cards will show cached values" ;;
    esac
  fi
  return 0
}

check_env_files() {
  local back="$ENV_DIR/back-stage.env" face="$ENV_DIR/watch-face.env" mode file
  [[ -f "$back" ]] || fail "$back is missing (docs/linux-deployment.md §3)"
  [[ -f "$face" ]] || fail "$face is missing (docs/linux-deployment.md §3)"
  for file in "$back" "$face"; do
    mode="$(stat -c '%a' "$file")"
    [[ "$mode" == 640 || "$mode" == 600 ]] || warn "$file has mode $mode; expected 0640 root:$RUN_USER"
  done
  check_secrets "$back" "$face"
  # Without it, watch-face's /api/control falls back to the docker hostname "back-stage" and silently fails.
  [[ -n "$(env_value "$face" CONTROL_PLANE_URL)" ]] || fail "CONTROL_PLANE_URL missing in $face (native value: http://127.0.0.1:3001)"
}
