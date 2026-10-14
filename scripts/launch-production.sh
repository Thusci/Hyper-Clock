#!/usr/bin/env bash
# Hyper Clock — deploy and launch in one go: scripts/deploy.sh, then scripts/launch.sh.
#
#   sudo scripts/launch-production.sh                     # deploy what changed and (re)start everything
#   sudo scripts/launch-production.sh --takeover-display  # first kiosk start
#   sudo scripts/launch-production.sh --check             # preflight and health checks only
#
# Every option of either script is accepted and passed to the script that understands it
# (--docker and --no-kiosk go to both); see scripts/deploy.sh --help and scripts/launch.sh --help.
set -euo pipefail

here="$(dirname "${BASH_SOURCE[0]}")"
deploy_args=() launch_args=() check=0
for arg in "$@"; do
  case "$arg" in
    --rebuild|--skip-build|--with-daemon) deploy_args+=("$arg") ;;
    --takeover-display|--stop) launch_args+=("$arg") ;;
    --docker|--no-kiosk) deploy_args+=("$arg"); launch_args+=("$arg") ;;
    --check) check=1; deploy_args+=("$arg"); launch_args+=("$arg") ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see $here/deploy.sh --help and $here/launch.sh --help)" >&2; exit 64 ;;
  esac
done

# launch.sh --check repeats the preflight, so skip the deploy half when only checking.
(( check )) || "$here/deploy.sh" "${deploy_args[@]}"
"$here/launch.sh" "${launch_args[@]}"
