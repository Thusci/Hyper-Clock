#!/usr/bin/env bash
# Hyper Clock — launch (or restart) the deployed services on the Fujitsu Q775.
#
# Run scripts/deploy.sh first; this script builds nothing and never touches the code in /opt/hyper-clock:
#   preflight → back-stage → watch-face → nginx → (sensor daemon) → kiosk → health checks on 3001, 3000 and 8080.
# It never touches the display manager unless --takeover-display is given.
# Docker mode starts the docker-compose.yml stack instead.
#
#   sudo scripts/launch.sh                     # (re)start everything
#   sudo scripts/launch.sh --takeover-display  # first kiosk start: disable gdm3 so the kiosk owns tty1
#   sudo scripts/launch.sh --no-kiosk          # services only, leave the local screen alone
#   sudo scripts/launch.sh --check             # health checks only, change nothing
#   sudo scripts/launch.sh --stop              # stop the kiosk and both services
#   scripts/launch.sh --docker                 # docker compose up -d
#
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

MODE="native"
WITH_KIOSK=1
TAKEOVER_DISPLAY=0
CHECK_ONLY=0
STOP=0

usage() {
  usage_header "$0"
  cat <<'EOF'
Options:
  --docker             Start the docker compose stack instead of the native systemd services
  --no-kiosk           Do not start the Xorg/Openbox/Chromium kiosk on tty1
  --takeover-display   Allow disabling gdm3 so the kiosk can own tty1
  --check              Run preflight and health checks only, change nothing
  --stop               Stop the kiosk, watch-face and back-stage (Nginx keeps running)
  -h, --help           Show this help
Environment overrides: APP_DIR, ENV_DIR, RUN_USER
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE="docker" ;;
    --no-kiosk) WITH_KIOSK=0 ;;
    --takeover-display) TAKEOVER_DISPLAY=1 ;;
    --check) CHECK_ONLY=1 ;;
    --stop) STOP=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

DEPLOY_HINT="run: sudo $(dirname "$0")/deploy.sh"

# Shows only this start attempt's log lines, not the crash loop from earlier runs.
show_log() {
  local unit="$1" since="$2"
  journalctl -u "$unit" --since "@$since" -n 40 --no-pager -o cat >&2 || true
}

# ── preflight ───────────────────────────────────────────────────────────────
preflight() {
  step "Preflight"
  require_root_and_app_dir
  check_env_files
  local unit name server
  for unit in "${WEB_UNITS[@]}"; do
    [[ -f "/etc/systemd/system/$unit" ]] || fail "$unit is not installed; $DEPLOY_HINT"
  done
  [[ -f /etc/nginx/sites-enabled/hyper-clock ]] || fail "Nginx site hyper-clock is not enabled; $DEPLOY_HINT"
  for name in back-stage watch-face; do
    server="$(standalone_server "$name")" || fail "$name has no standalone build in $APP_DIR/$name/.next; $DEPLOY_HINT"
    [[ -L "$APP_DIR/$name/.env" ]] || warn "$APP_DIR/$name/.env is not linked to $ENV_DIR; $DEPLOY_HINT"
  done
  ok "Units installed and both builds present"
  if (( WITH_KIOSK )) && (( ! CHECK_ONLY )); then
    [[ -f "/etc/systemd/system/$KIOSK_UNIT" ]] || fail "$KIOSK_UNIT is not installed; $DEPLOY_HINT (or pass --no-kiosk)"
    command -v startx >/dev/null || fail "Xorg/xinit missing for the kiosk (or pass --no-kiosk)"
    command -v chromium >/dev/null || command -v chromium-browser >/dev/null || fail "Chromium missing for the kiosk (sudo snap install chromium, or pass --no-kiosk)"
    ok "Xorg and Chromium available for the kiosk"
  fi
}

# ── start ───────────────────────────────────────────────────────────────────
start_unit() {
  local unit="$1" name="$2" url="$3" since
  since="$(date +%s)"
  systemctl reset-failed "$unit" 2>/dev/null || true
  systemctl restart "$unit"
  wait_for "$name" "$url" || { show_log "$unit" "$since"; fail "$name did not become healthy (journalctl -u $unit)"; }
}

start_services() {
  step "Start"
  start_unit hyper-clock-back-stage.service back-stage "http://127.0.0.1:3001/api/health"
  start_unit hyper-clock-watch-face.service watch-face "http://127.0.0.1:3000/api/health"
  if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl start nginx; fi
  wait_for "gateway" "http://127.0.0.1:8080/api/health" || fail "Nginx is not proxying 8080 → 3001 (sudo nginx -t; journalctl -u nginx)"

  if systemctl cat "$DAEMON_UNIT" >/dev/null 2>&1; then
    step "Q775 sensor daemon"
    systemctl is-active --quiet "$DAEMON_UNIT" || systemctl start "$DAEMON_UNIT"
    wait_for "sensor daemon" "http://127.0.0.1:8765/health" 20 || warn "Sensor daemon did not answer on 8765; check journalctl -u q775-sensor-daemon"
  fi
}

start_kiosk() {
  (( WITH_KIOSK )) || return 0
  step "Kiosk"
  # gdm3 that is merely enabled would still grab tty1 on the next boot.
  if systemctl is-active --quiet gdm3.service 2>/dev/null || systemctl is-enabled --quiet gdm3.service 2>/dev/null; then
    if (( TAKEOVER_DISPLAY )); then
      systemctl disable --now gdm3.service
      ok "gdm3 disabled so the kiosk can own tty1 (undo: systemctl enable --now gdm3)"
    else
      warn "gdm3 is running or enabled and owns the screen. Re-run with --takeover-display to hand tty1 to the kiosk."
      return 0
    fi
  fi
  local since
  since="$(date +%s)"
  systemctl enable "$KIOSK_UNIT" >/dev/null 2>&1
  systemctl reset-failed "$KIOSK_UNIT" 2>/dev/null || true
  systemctl restart "$KIOSK_UNIT"
  sleep 4
  if systemctl is-active --quiet "$KIOSK_UNIT"; then
    ok "Kiosk session running on tty1"
    info "Verify GPU acceleration once: open chrome://gpu and confirm 'WebGL: Hardware accelerated'"
  else
    show_log "$KIOSK_UNIT" "$since"
    fail "Kiosk session failed to start"
  fi
}

stop_all() {
  step "Stop"
  local unit
  for unit in "$KIOSK_UNIT" hyper-clock-watch-face.service hyper-clock-back-stage.service; do
    if systemctl is-active --quiet "$unit" 2>/dev/null; then systemctl stop "$unit"; ok "stopped $unit"; fi
  done
  info "Nginx keeps running; the services stay enabled and start again on boot."
}

health_report() {
  step "Status"
  local unit
  for unit in hyper-clock-back-stage hyper-clock-watch-face nginx $( (( WITH_KIOSK )) && echo hyper-clock-kiosk ); do
    printf '  %-26s %s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"
  done
  # Services must stay on loopback; only Nginx faces the LAN.
  if ss -lnt 2>/dev/null | awk '{print $4}' | grep -E '^(0\.0\.0\.0|\*|\[::\]):(3000|3001)$' >/dev/null; then
    warn "Port 3000/3001 is listening on all interfaces; only 8080 should be reachable from the LAN"
  else
    ok "3000/3001 bound to loopback only"
  fi
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '\n  Watch face   http://%s:8080/\n  Admin        http://%s:8080/admin\n  HA console   http://%s:8080/ha\n' "${ip:-Q775_IP}" "${ip:-Q775_IP}" "${ip:-Q775_IP}"
  info "Logs: journalctl -u hyper-clock-back-stage -u hyper-clock-watch-face -f"
}

check_only() {
  preflight
  step "Health"
  wait_for "back-stage" "http://127.0.0.1:3001/api/health" 3 || warn "back-stage not answering on 3001"
  wait_for "watch-face" "http://127.0.0.1:3000/api/health" 3 || warn "watch-face not answering on 3000"
  wait_for "gateway" "http://127.0.0.1:8080/api/health" 3 || warn "gateway not answering on 8080"
  health_report
}

# ── docker mode ─────────────────────────────────────────────────────────────
launch_docker() {
  command -v docker >/dev/null || fail "docker is not installed"
  docker compose version >/dev/null 2>&1 || fail "the docker compose plugin is required"
  if (( STOP )); then (cd "$SOURCE_DIR" && docker compose stop); exit 0; fi
  if (( CHECK_ONLY )); then (cd "$SOURCE_DIR" && docker compose ps); exit 0; fi
  step "docker compose up"
  (cd "$SOURCE_DIR" && docker compose up -d)
  wait_for "gateway" "http://127.0.0.1:8080/api/health" 90 || { (cd "$SOURCE_DIR" && docker compose logs --tail 40); fail "gateway did not become healthy"; }
  (cd "$SOURCE_DIR" && docker compose ps)
  info "The local kiosk browser is not managed in docker mode; point Chromium at http://127.0.0.1:8080/"
}

# ── main ────────────────────────────────────────────────────────────────────
printf '%sHyper Clock · launch (%s)%s\n' "$BOLD" "$MODE" "$RESET"
if [[ "$MODE" == docker ]]; then launch_docker; exit 0; fi
if (( STOP )); then require_root_and_app_dir; stop_all; exit 0; fi
if (( CHECK_ONLY )); then check_only; exit 0; fi

preflight
start_services
start_kiosk
health_report
printf '\n%sHyper Clock is live.%s\n' "$GREEN" "$RESET"
