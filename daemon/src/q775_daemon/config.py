from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(slots=True)
class ServerConfig:
    host: str = "0.0.0.0"  # noqa: S104 - LAN service for Home Assistant, protected by bearer authentication
    port: int = 8765
    token: str = ""
    telemetry_interval_seconds: float = 5.0
    device_refresh_seconds: float = 1800.0
    allowed_origins: list[str] = field(default_factory=list)


@dataclass(slots=True)
class CollectorConfig:
    sys_root: Path = Path("/sys")
    # SMART health is read every device_refresh_seconds (30 min by default).
    enable_smart: bool = True
    # Off by default: the full udev tree (~860 devices) and PowerTOP sampling cost CPU and add no
    # value on the face. PowerTOP in particular runs a 5 s root measurement every minute.
    enable_udev: bool = False
    enable_powertop: bool = False
    powertop_interval_seconds: float = 300.0
    powertop_sample_seconds: int = 5
    max_udev_devices: int = 4096


@dataclass(slots=True)
class CameraConfig:
    enabled: bool = True
    ffmpeg: str = "/usr/bin/ffmpeg"
    width: int = 1280
    height: int = 720
    fps: int = 10
    jpeg_quality: int = 5
    max_streams: int = 2


@dataclass(slots=True)
class DisplayConfig:
    # sysfs backlight name; empty picks the first raw/firmware backlight (intel_backlight on the Q775).
    backlight: str = ""
    # Brightness never drops below this when the screen is "on" (0 would look like a dead panel).
    min_brightness_percent: int = 5


@dataclass(slots=True)
class PowerConfig:
    allow_suspend: bool = True
    # Arm Wake-on-WLAN (magic packet) before suspending, so Home Assistant can wake the tablet.
    wake_on_wlan: bool = True
    # Wireless interface for Wake-on-WLAN; empty picks the first wireless interface.
    wifi_interface: str = ""


@dataclass(slots=True)
class InputConfig:
    # Passively watch the hardware buttons and turn the screen back on, even if the browser hangs.
    wake_on_keys: bool = True
    # Linux key codes: 114 VOLUMEDOWN, 115 VOLUMEUP, 125 LEFTMETA (Windows button), 126 RIGHTMETA.
    wake_keys: list[int] = field(default_factory=lambda: [114, 115, 125, 126])


@dataclass(slots=True)
class Config:
    server: ServerConfig
    collectors: CollectorConfig
    camera: CameraConfig
    display: DisplayConfig = field(default_factory=DisplayConfig)
    power: PowerConfig = field(default_factory=PowerConfig)
    input: InputConfig = field(default_factory=InputConfig)


def load_config(path: Path) -> Config:
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    server = ServerConfig(**raw.get("server", {}))
    collector_raw = raw.get("collectors", {})
    collectors = CollectorConfig(**{**collector_raw, "sys_root": Path(collector_raw.get("sys_root", "/sys"))})
    camera = CameraConfig(**raw.get("camera", {}))
    display = DisplayConfig(**raw.get("display", {}))
    power = PowerConfig(**raw.get("power", {}))
    inputs = InputConfig(**raw.get("input", {}))
    env_token = os.getenv("Q775_DAEMON_TOKEN")
    if env_token:
        server.token = env_token
    if len(server.token) < 24 or server.token.startswith("replace-"):
        raise ValueError("server.token must contain at least 24 random characters")
    if server.telemetry_interval_seconds < 1:
        raise ValueError("telemetry_interval_seconds must be at least 1")
    if collectors.powertop_sample_seconds < 1:
        raise ValueError("powertop_sample_seconds must be at least 1")
    if not 0 <= display.min_brightness_percent <= 50:
        raise ValueError("display.min_brightness_percent must be between 0 and 50")
    return Config(
        server=server, collectors=collectors, camera=camera, display=display, power=power, input=inputs
    )
