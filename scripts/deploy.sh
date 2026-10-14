#!/usr/bin/env bash
# Hyper Clock — deploy to the Fujitsu Q775 (Ubuntu + systemd + Nginx + Openbox/Chromium).
#
# Puts a runnable build in place; scripts/launch.sh then starts it. Follows docs/linux-deployment.md §4–7:
#   preflight → back up runtime data → sync code to /opt/hyper-clock → link env files
#   → npm ci + typecheck + build (only what changed) → install systemd units + Nginx site.
# The running services are stopped only when a module has to be rebuilt (the build replaces their files).
# Docker mode builds the docker-compose.yml images instead.
#
#   sudo scripts/deploy.sh                  # sync and build what changed, install units and Nginx site
#   sudo scripts/deploy.sh --rebuild        # force npm ci + build for both apps
#   sudo scripts/deploy.sh --with-daemon    # also install the Q775 sensor daemon
#   sudo scripts/deploy.sh --check          # preflight only, change nothing
#   scripts/deploy.sh --docker              # docker compose build
#
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

MODE="native"
REBUILD=0
SKIP_BUILD=0
WITH_KIOSK=1
WITH_DAEMON=0
CHECK_ONLY=0
STOPPED=0

usage() {
  usage_header "$0"
  cat <<'EOF'
Options:
  --docker             Build the docker compose images instead of the native deployment
  --rebuild            Force npm ci + build for both apps
  --skip-build         Never build (keep the existing .next output)
  --no-kiosk           Do not check for or install the Xorg/Openbox/Chromium kiosk unit
  --with-daemon        Also install the Q775 sensor daemon (daemon/scripts/install-ubuntu.sh)
  --check              Run preflight only, change nothing
  -h, --help           Show this help
Environment overrides: APP_DIR, ENV_DIR, RUN_USER
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE="docker" ;;
    --rebuild) REBUILD=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --no-kiosk) WITH_KIOSK=0 ;;
    --with-daemon) WITH_DAEMON=1 ;;
    --check) CHECK_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

# Runs a command as the service account, keeping its output in a log that is shown only on failure.
# (next build and tsc report errors on stdout, so discarding stdout would hide the reason.)
run_logged() {
  local label="$1"; shift
  local log
  log="$(mktemp)"
  if ! as_user "$@" >"$log" 2>&1; then
    tail -n 60 "$log" >&2
    rm -f "$log"
    fail "$label failed"
  fi
  rm -f "$log"
}

# ── preflight ───────────────────────────────────────────────────────────────
preflight() {
  step "Preflight"
  require_root_and_app_dir
  for tool in node npm nginx rsync sha256sum; do command -v "$tool" >/dev/null || fail "$tool is not installed (see docs/linux-deployment.md §2)"; done
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  (( node_major >= REQUIRED_NODE_MAJOR )) || fail "Node.js $REQUIRED_NODE_MAJOR LTS required, found $(node --version)"
  [[ "$(command -v node)" == /usr/bin/node ]] || warn "node is $(command -v node); the systemd units call /usr/bin/node — update ExecStart if that path is wrong"
  ok "Node $(node --version), npm $(npm --version), nginx present"
  id "$RUN_USER" >/dev/null 2>&1 || fail "Service account '$RUN_USER' missing: sudo adduser --disabled-password --gecos 'Hyper Clock' $RUN_USER"
  ok "Service account $RUN_USER"
  # grep without -q reads all input, so the writer never gets SIGPIPE (which pipefail would report as failure).
  if fc-list 2>/dev/null | grep -i "Noto Sans CJK" >/dev/null; then ok "CJK font installed"; else warn "fonts-noto-cjk not found; Chinese text will fall back to a system font (sudo apt install fonts-noto-cjk)"; fi
  check_env_files
  if (( WITH_KIOSK )); then
    command -v startx >/dev/null || fail "Xorg/xinit missing for the kiosk (or pass --no-kiosk)"
    command -v chromium >/dev/null || command -v chromium-browser >/dev/null || fail "Chromium missing for the kiosk (sudo snap install chromium, or pass --no-kiosk)"
    ok "Xorg and Chromium available for the kiosk"
  fi
}

# ── data ────────────────────────────────────────────────────────────────────
# Releases before the HYPER_CLOCK_DATA_DIR fix wrote back-stage's runtime data into its build output
# (the standalone server chdirs there). A rebuild wipes that directory, so it is backed up and moved first.
stranded_data_dir() {
  local server
  server="$(standalone_server back-stage)" || return 1
  [[ -d "$(dirname "$server")/data" ]] && printf '%s\n' "$(dirname "$server")/data"
}

backup_data() {
  local live="$APP_DIR/back-stage/data" stranded backup
  stranded="$(stranded_data_dir || true)"
  [[ -d "$live" || -n "$stranded" ]] || return 0
  backup="$APP_DIR/back-stage/data.backup-$(date +%Y%m%d-%H%M%S)"
  install -d -o "$RUN_USER" -g "$RUN_USER" -m 0700 "$backup"
  [[ -d "$live" ]] && cp -a "$live/." "$backup/"
  [[ -n "$stranded" ]] && { install -d "$backup/from-build-output"; cp -a "$stranded/." "$backup/from-build-output/"; }
  chown -R "$RUN_USER:$RUN_USER" "$backup"
  ok "Runtime data backed up to $backup"
  # Keep the five most recent backups.
  find "$APP_DIR/back-stage" -maxdepth 1 -type d -name 'data.backup-*' | sort | head -n -5 | xargs -r rm -rf
}

# Copies runtime files that are newer in the build output into back-stage/data (the service must be stopped).
rescue_stranded_data() {
  local stranded live="$APP_DIR/back-stage/data" file count=0
  stranded="$(stranded_data_dir || true)"
  [[ -n "$stranded" ]] || return 0
  install -d -o "$RUN_USER" -g "$RUN_USER" "$live"
  for file in "$stranded"/runtime-* "$stranded"/audit.ndjson; do
    [[ -f "$file" ]] || continue
    if [[ ! -e "$live/${file##*/}" || "$file" -nt "$live/${file##*/}" ]]; then
      cp -p "$file" "$live/" && count=$((count + 1))
    fi
  done
  chown -R "$RUN_USER:$RUN_USER" "$live"
  (( count == 0 )) || ok "Moved $count runtime file(s) from the old build output into $live"
}

# ── code ────────────────────────────────────────────────────────────────────
sync_code() {
  step "Code"
  backup_data
  if [[ "$(realpath "$SOURCE_DIR")" == "$(realpath -m "$APP_DIR")" ]]; then
    ok "Running from $APP_DIR, no sync needed"
    return
  fi
  install -d -o "$RUN_USER" -g "$RUN_USER" "$APP_DIR"
  # Never overwrite live runtime data, env files or build output from the source checkout.
  rsync -a --delete \
    --exclude node_modules --exclude .next --exclude '.env' --exclude '.env.*' --exclude '.env copy' \
    --exclude '*.tsbuildinfo' --exclude '.venv' --exclude '.pytest_cache' --exclude '.ruff_cache' \
    --exclude '.test-tmp*' --exclude 'pytest-cache-files-*' --exclude '*.egg-info' \
    --exclude 'back-stage/data/runtime-*' --exclude 'back-stage/data/audit.ndjson' --exclude 'back-stage/data.backup-*' \
    --exclude 'watch-face/data/runtime-config.json' \
    "$SOURCE_DIR/" "$APP_DIR/"
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"
  ok "Synced $SOURCE_DIR → $APP_DIR"
}

link_env() {
  ln -sfn "$ENV_DIR/back-stage.env" "$APP_DIR/back-stage/.env"
  ln -sfn "$ENV_DIR/watch-face.env" "$APP_DIR/watch-face/.env"
  install -d -o "$RUN_USER" -g "$RUN_USER" "$APP_DIR/back-stage/data"
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/back-stage/data"
  chmod 0755 "$APP_DIR/deploy/linux/kiosk-session"
  ok "Env files linked, data directory owned by $RUN_USER"
}

# ── build ───────────────────────────────────────────────────────────────────
# Content hash of everything that goes into a module's build. rsync keeps source mtimes,
# so comparing timestamps against the last build can miss changes; hashes cannot.
fingerprint() {
  local name="$1" dir="$APP_DIR/$1"
  {
    cd "$dir"
    find -L src public package.json package-lock.json next.config.mjs tsconfig.json postcss.config.mjs .env data/default-config.json \
      -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum || true
    # back-stage bundles ../ha-console (file: dependency, transpilePackages).
    [[ "$name" != back-stage ]] || { cd "$APP_DIR/ha-console" && find src package.json package-lock.json -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum || true; }
  } | sha256sum | cut -d' ' -f1
}

fingerprint_file() { printf '%s/%s/.next/deploy-fingerprint\n' "$APP_DIR" "$1"; }

needs_build() {
  local name="$1"
  (( REBUILD )) && return 0
  standalone_server "$name" >/dev/null || return 0
  [[ "$(cat "$(fingerprint_file "$name")" 2>/dev/null)" == "$(fingerprint "$name")" ]] && return 1
  return 0
}

# A rebuild replaces .next under the running servers, so stop them once before the first build.
stop_services_for_build() {
  (( STOPPED )) && return
  STOPPED=1
  local unit
  for unit in "$KIOSK_UNIT" "${WEB_UNITS[@]}"; do
    systemctl is-active --quiet "$unit" 2>/dev/null && { systemctl stop "$unit"; info "stopped $unit for the build"; }
  done
  rescue_stranded_data
}

build_module() {
  local name="$1" dir="$APP_DIR/$1"
  if (( SKIP_BUILD )); then info "$name: build skipped (--skip-build)"; return; fi
  if ! needs_build "$name"; then ok "$name: build is up to date"; return; fi
  stop_services_for_build
  if [[ "$name" == back-stage ]]; then
    # back-stage links ../ha-console as a file: dependency; install its own dependencies first (as the Dockerfile does).
    info "ha-console: npm ci"
    run_logged "ha-console npm ci" npm --prefix "$APP_DIR/ha-console" ci --no-audit --no-fund
  fi
  info "$name: npm ci"
  run_logged "$name npm ci" npm --prefix "$dir" ci --no-audit --no-fund
  info "$name: typecheck"
  run_logged "$name typecheck" npm --prefix "$dir" run typecheck
  info "$name: next build (fonts are fetched once here; the kiosk itself needs no internet)"
  run_logged "$name build" npm --prefix "$dir" run build
  local server
  server="$(standalone_server "$name")" || fail "$name build finished but produced no standalone server.js under $dir/.next/standalone"
  fingerprint "$name" >"$(fingerprint_file "$name")"
  chown "$RUN_USER:$RUN_USER" "$(fingerprint_file "$name")"
  ok "$name built (${server#"$dir/"})"
}

# ── system integration ──────────────────────────────────────────────────────
install_units() {
  step "System integration"
  local units=("${WEB_UNITS[@]}") unit
  (( WITH_KIOSK )) && units+=("$KIOSK_UNIT")
  for unit in "${units[@]}"; do install -m 0644 "$APP_DIR/deploy/linux/$unit" /etc/systemd/system/; done
  systemctl daemon-reload
  systemctl enable "${WEB_UNITS[@]}" >/dev/null 2>&1
  ok "systemd units installed: ${units[*]}"

  install -m 0644 "$APP_DIR/deploy/linux/nginx-hyper-clock.conf" /etc/nginx/sites-available/hyper-clock
  ln -sfn /etc/nginx/sites-available/hyper-clock /etc/nginx/sites-enabled/hyper-clock
  local other
  other="$(grep -lE 'listen[^;]*8080' /etc/nginx/sites-enabled/* 2>/dev/null | grep -v '/hyper-clock$' || true)"
  [[ -z "$other" ]] || warn "Another enabled nginx site also listens on 8080: $other"
  nginx -t >/dev/null 2>&1 || { nginx -t; fail "nginx configuration test failed"; }
  systemctl enable nginx >/dev/null 2>&1
  ok "Nginx site installed and valid"

  if (( WITH_DAEMON )); then
    step "Q775 sensor daemon"
    bash "$APP_DIR/daemon/scripts/install-ubuntu.sh"
    ok "Sensor daemon installed"
  fi
}

# ── docker mode ─────────────────────────────────────────────────────────────
deploy_docker() {
  step "Docker preflight"
  command -v docker >/dev/null || fail "docker is not installed"
  docker compose version >/dev/null 2>&1 || fail "the docker compose plugin is required"
  [[ -f "$SOURCE_DIR/.env" ]] || fail "$SOURCE_DIR/.env is missing (copy .env.example; it holds KIOSK_SHARED_SECRET)"
  [[ -f "$SOURCE_DIR/back-stage/.env" ]] || fail "$SOURCE_DIR/back-stage/.env is missing (copy back-stage/.env.example)"
  [[ "$(env_value "$SOURCE_DIR/back-stage/.env" HA_URL)" == *homeassistant* ]] || warn "HA_URL does not point at the bundled 'homeassistant' service; fine if you use an external HA"
  check_secrets "$SOURCE_DIR/back-stage/.env" "$SOURCE_DIR/.env" "$SOURCE_DIR/.env"
  (( CHECK_ONLY )) && exit 0
  step "docker compose build"
  (cd "$SOURCE_DIR" && docker compose build $( (( REBUILD )) && echo --no-cache ))
  ok "Images built; start them with scripts/launch.sh --docker"
}

# ── main ────────────────────────────────────────────────────────────────────
printf '%sHyper Clock · deploy (%s)%s\n' "$BOLD" "$MODE" "$RESET"
if [[ "$MODE" == docker ]]; then deploy_docker; exit 0; fi

preflight
(( CHECK_ONLY )) && exit 0
sync_code
step "Build"
link_env
build_module back-stage
build_module watch-face
install_units

LAUNCH="$(dirname "$0")/launch.sh"
printf '\n%sDeployed to %s.%s\n' "$GREEN" "$APP_DIR" "$RESET"
if (( STOPPED )); then info "Services were stopped for the build; start them with: sudo $LAUNCH"
else info "Restart the services to pick up the new code: sudo $LAUNCH"; fi
