from __future__ import annotations

import asyncio
import logging
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import PowerConfig
from .util import read_text

log = logging.getLogger(__name__)


class SleepError(RuntimeError):
    pass


class SleepController:
    """
    System sleep and wake for the tablet.

    A suspended machine cannot wake itself from software, so before suspending this arms every
    wake source it can:
      - Wake-on-WLAN (magic packet): Home Assistant's `wake_on_lan.send_magic_packet` with the
        Wi-Fi MAC reported in /api/v1/state wakes the tablet at any time;
      - an RTC alarm (optional `wake_at` / `wake_in_minutes`) for a scheduled wake;
      - the power button, as always.
    Suspend goes through systemd-logind (`systemctl suspend`), so it honours the system's
    configured sleep mode (s2idle or deep) and any inhibitors.
    """

    def __init__(self, sys_root: Path, config: PowerConfig) -> None:
        self.sys_root = sys_root
        self.config = config
        self.last_sleep: dict[str, Any] | None = None
        self._pending: asyncio.Task[None] | None = None

    # ── wake sources ──────────────────────────────────────────────────────────
    def wifi(self) -> dict[str, Any]:
        for interface in sorted((self.sys_root / "class/net").glob("*")):
            if self.config.wifi_interface and interface.name != self.config.wifi_interface:
                continue
            if not (interface / "wireless").exists() and not (interface / "phy80211").exists():
                continue
            phy = (interface / "phy80211").resolve().name if (interface / "phy80211").exists() else None
            return {"interface": interface.name, "mac": read_text(interface / "address"), "phy": phy}
        return {}

    async def _iw(self, *args: str) -> tuple[int, str]:
        executable = shutil.which("iw")
        if not executable:
            return 127, "iw not installed"
        try:
            process = await asyncio.create_subprocess_exec(
                executable, *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
            )
            output, _ = await asyncio.wait_for(process.communicate(), timeout=5)
        except (OSError, TimeoutError) as error:
            return 1, str(error)
        return process.returncode or 0, output.decode(errors="replace").strip()

    async def wowlan_status(self) -> dict[str, Any]:
        wifi = self.wifi()
        if not wifi.get("phy"):
            return {"supported": False, "reason": "no wireless interface"}
        code, output = await self._iw("phy", wifi["phy"], "wowlan", "show")
        if code:
            return {"supported": False, "reason": output[:160]}
        return {
            "supported": True,
            "enabled": "magic-packet" in output.lower() or "magic packet" in output.lower(),
            **wifi,
        }

    async def _arm_wowlan(self) -> str:
        wifi = self.wifi()
        if not self.config.wake_on_wlan or not wifi.get("phy"):
            return "disabled" if not self.config.wake_on_wlan else "no wireless interface"
        code, output = await self._iw("phy", wifi["phy"], "wowlan", "enable", "magic-packet")
        return "armed" if code == 0 else f"unsupported: {output[:120]}"

    def _arm_rtc(self, wake_at: datetime | None) -> str:
        alarm = self.sys_root / "class/rtc/rtc0/wakealarm"
        if not wake_at:
            return "none"
        if not alarm.exists():
            return "no rtc"
        try:
            alarm.write_text("0", encoding="ascii")  # clear any previous alarm first
            alarm.write_text(str(int(wake_at.timestamp())), encoding="ascii")
        except OSError as error:
            return f"failed: {error}"
        return wake_at.astimezone(UTC).isoformat()

    # ── sleep ─────────────────────────────────────────────────────────────────
    def schedule_suspend(self, wake_at: datetime | None, on_resume) -> dict[str, Any]:
        if not self.config.allow_suspend:
            raise SleepError("suspend is disabled in [power].allow_suspend")
        if wake_at and wake_at.timestamp() < time.time() + 60:
            raise SleepError("wake time must be at least one minute ahead")
        if not shutil.which("systemctl"):
            raise SleepError("systemctl not available")
        if self._pending and not self._pending.done():
            raise SleepError("a suspend is already pending")
        # Run after the HTTP response has been sent.
        self._pending = asyncio.create_task(self._suspend(wake_at, on_resume))
        return {"accepted": True, "wake_at": wake_at.isoformat() if wake_at else None}

    async def _suspend(self, wake_at: datetime | None, on_resume) -> None:
        await asyncio.sleep(1.5)
        wowlan = await self._arm_wowlan()
        rtc = self._arm_rtc(wake_at)
        started_wall, started_mono = time.time(), time.monotonic()
        self.last_sleep = {"requested_at": datetime.now(UTC).isoformat(), "wowlan": wowlan, "rtc": rtc}
        log.info("suspending (wowlan=%s, rtc=%s)", wowlan, rtc)
        process = await asyncio.create_subprocess_exec(
            "systemctl", "suspend", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        output, _ = await process.communicate()
        # `systemctl suspend` returns once the request is queued; wait until the clock shows a gap.
        for _ in range(60):
            await asyncio.sleep(1)
            if time.time() - started_wall - (time.monotonic() - started_mono) > 5:
                break
        slept = time.time() - started_wall - (time.monotonic() - started_mono)
        self.last_sleep.update(
            {
                "resumed_at": datetime.now(UTC).isoformat(),
                "slept_seconds": round(max(0.0, slept)),
                "result": "resumed"
                if slept > 5
                else (output.decode(errors="replace").strip()[:160] or "did not suspend"),
            }
        )
        log.info("resume: %s", self.last_sleep)
        await on_resume()
