#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="/opt/q775-sensor-daemon"
CONFIG_DIR="/etc/q775-daemon"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

apt-get update
# iw arms Wake-on-WLAN; ffmpeg/v4l-utils serve the camera; smartmontools reads disk health.
# PowerTOP is optional now ([collectors].enable_powertop): apt-get install powertop to use it.
apt-get install -y python3 python3-venv iw ffmpeg v4l-utils smartmontools

install -d -m 0755 "${INSTALL_DIR}" "${CONFIG_DIR}"
cp -a "${SOURCE_DIR}/pyproject.toml" "${SOURCE_DIR}/src" "${INSTALL_DIR}/"
python3 -m venv "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip setuptools wheel
"${INSTALL_DIR}/.venv/bin/pip" install "${INSTALL_DIR}"

if [[ ! -f "${CONFIG_DIR}/config.toml" ]]; then
  token="$(openssl rand -hex 32)"
  sed "s/replace-with-at-least-32-random-characters/${token}/" "${SOURCE_DIR}/config.example.toml" > "${CONFIG_DIR}/config.toml"
  chmod 0600 "${CONFIG_DIR}/config.toml"
fi

# Upgrade from 0.1: its example config switched on the udev tree and PowerTOP, which 0.2 keeps off.
if grep -Eq '^(enable_udev|enable_powertop)[[:space:]]*=[[:space:]]*true' "${CONFIG_DIR}/config.toml"; then
  sed -i -E 's/^(enable_udev|enable_powertop)([[:space:]]*=[[:space:]]*)true/\1\2false/' "${CONFIG_DIR}/config.toml"
  echo "Turned off enable_udev / enable_powertop in ${CONFIG_DIR}/config.toml (0.2 defaults)."
fi

install -m 0644 "${SOURCE_DIR}/systemd/q775-sensor-daemon.service" /etc/systemd/system/q775-sensor-daemon.service
systemctl daemon-reload
systemctl enable q775-sensor-daemon.service
# restart (not just start) so an upgrade from 0.1 picks up the new code and unit.
systemctl restart q775-sensor-daemon.service

# A wall display must not fall asleep on its own; sleep happens only when asked (HA / the sidecar API).
if command -v gsettings >/dev/null 2>&1 && [[ -n "${SUDO_USER:-}" ]]; then
  sudo -u "${SUDO_USER}" gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true
fi

echo "Installed. Token is stored only in ${CONFIG_DIR}/config.toml."
echo "Health: curl http://127.0.0.1:8765/health"

