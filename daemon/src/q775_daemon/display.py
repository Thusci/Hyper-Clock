from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import DisplayConfig
from .util import number, read_text

# Kernel backlight types in order of preference: "raw" drives the panel directly (intel_backlight),
# "firmware" goes through ACPI, "platform" is a vendor driver.
_TYPE_ORDER = {"raw": 0, "firmware": 1, "platform": 2}
BL_POWER_ON = 0
BL_POWER_OFF = 4  # FB_BLANK_POWERDOWN


class DisplayError(RuntimeError):
    pass


class Backlight:
    """
    Screen on/off and brightness through /sys/class/backlight.

    Works the same under Xorg, Wayland or no display server at all, needs no X authority, and
    is instant in both directions. "Off" writes bl_power=4 when the driver supports it (panel
    backlight powered down); otherwise brightness goes to 0. "On" restores the last brightness.
    """

    def __init__(self, sys_root: Path, config: DisplayConfig) -> None:
        self.sys_root = sys_root
        self.config = config
        self._restore_raw: int | None = None
        self._soft_off = False

    def _device(self) -> Path:
        root = self.sys_root / "class/backlight"
        candidates = sorted(root.glob("*"))
        if self.config.backlight:
            candidates = [item for item in candidates if item.name == self.config.backlight]
        candidates.sort(key=lambda item: _TYPE_ORDER.get(read_text(item / "type") or "", 9))
        if not candidates:
            raise DisplayError("no backlight device found")
        return candidates[0]

    def _read(self, device: Path) -> tuple[int, int, int | None]:
        brightness = number(read_text(device / "brightness"))
        maximum = number(read_text(device / "max_brightness"))
        bl_power = number(read_text(device / "bl_power"))
        if not isinstance(brightness, (int, float)) or not isinstance(maximum, (int, float)) or maximum <= 0:
            raise DisplayError(f"unreadable backlight {device.name}")
        return int(brightness), int(maximum), int(bl_power) if isinstance(bl_power, (int, float)) else None

    @staticmethod
    def _write(path: Path, value: int) -> None:
        try:
            path.write_text(str(value), encoding="ascii")
        except OSError as error:
            raise DisplayError(f"cannot write {path}: {error}") from error

    def state(self) -> dict[str, Any]:
        try:
            device = self._device()
            brightness, maximum, bl_power = self._read(device)
        except DisplayError as error:
            return {"available": False, "reason": str(error)}
        on = (bl_power in (None, BL_POWER_ON)) and not self._soft_off and brightness > 0
        shown = self._restore_raw if not on and self._restore_raw else brightness
        return {
            "available": True,
            "backlight": device.name,
            "on": on,
            "brightness_percent": round(shown * 100 / maximum),
            "max_brightness": maximum,
        }

    def set_power(self, on: bool) -> dict[str, Any]:
        device = self._device()
        brightness, maximum, bl_power = self._read(device)
        floor = max(1, round(maximum * self.config.min_brightness_percent / 100))
        if on:
            if bl_power is not None and bl_power != BL_POWER_ON:
                self._write(device / "bl_power", BL_POWER_ON)
            if brightness < floor or self._soft_off:
                self._write(device / "brightness", max(floor, self._restore_raw or maximum // 2))
            self._soft_off = False
        else:
            if brightness > 0:
                self._restore_raw = brightness
            if bl_power is not None:
                self._write(device / "bl_power", BL_POWER_OFF)
            else:
                self._write(device / "brightness", 0)
                self._soft_off = True
        return self.state()

    def toggle(self) -> dict[str, Any]:
        return self.set_power(not self.state().get("on", True))

    def set_brightness(self, percent: float) -> dict[str, Any]:
        device = self._device()
        _, maximum, _ = self._read(device)
        clamped = min(100.0, max(float(self.config.min_brightness_percent), float(percent)))
        raw = max(1, round(maximum * clamped / 100))
        self._restore_raw = raw
        if self.state().get("on", True):
            self._write(device / "brightness", raw)
        return self.state()
