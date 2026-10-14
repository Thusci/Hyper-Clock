from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import psutil

from .config import CollectorConfig
from .util import json_value, number, read_text, slug

MICRO_FIELDS = {
    "voltage_now": (1_000_000, "voltage_v"),
    "voltage_min_design": (1_000_000, "voltage_min_design_v"),
    "current_now": (1_000_000, "current_a"),
    "power_now": (1_000_000, "power_w"),
    "energy_now": (1_000_000, "energy_wh"),
    "energy_full": (1_000_000, "energy_full_wh"),
    "energy_full_design": (1_000_000, "energy_full_design_wh"),
    "charge_now": (1_000_000, "charge_ah"),
    "charge_full": (1_000_000, "charge_full_ah"),
}


def collect_system() -> dict[str, Any]:
    cpu_freq = psutil.cpu_freq()
    load = os.getloadavg() if hasattr(os, "getloadavg") else (None, None, None)
    memory = psutil.virtual_memory()
    swap = psutil.swap_memory()
    return {
        "hostname": platform.node(),
        "platform": platform.platform(),
        "kernel": platform.release(),
        "boot_time": psutil.boot_time(),
        "uptime_seconds": max(0, time.time() - psutil.boot_time()),
        "cpu": {
            "percent": psutil.cpu_percent(interval=None),
            "per_core_percent": psutil.cpu_percent(interval=None, percpu=True),
            "physical_cores": psutil.cpu_count(logical=False),
            "logical_cores": psutil.cpu_count(logical=True),
            "frequency_mhz": cpu_freq.current if cpu_freq else None,
            "frequency_min_mhz": cpu_freq.min if cpu_freq else None,
            "frequency_max_mhz": cpu_freq.max if cpu_freq else None,
            "load_1m": load[0],
            "load_5m": load[1],
            "load_15m": load[2],
        },
        "memory": {
            "total_bytes": memory.total,
            "available_bytes": memory.available,
            "used_bytes": memory.used,
            "percent": memory.percent,
        },
        "swap": {"total_bytes": swap.total, "used_bytes": swap.used, "percent": swap.percent},
    }


def collect_iio(sys_root: Path) -> list[dict[str, Any]]:
    """Ambient light only. The Q775 also exposes accelerometer, gyro, inclinometer and compass
    channels; as raw axis counts they mean nothing on a wall-mounted display, so they are skipped."""
    result: list[dict[str, Any]] = []
    device_root = sys_root / "bus/iio/devices"
    # The underscore form is accepted only to make the sysfs fixture portable to Windows.
    devices = {*device_root.glob("iio:device*"), *device_root.glob("iio_device*")}
    for device in sorted(devices):
        channels = {
            item.name: number(read_text(item))
            for item in device.glob("in_illuminance*")
            if not item.name.endswith(("_available", "_en", "_hysteresis"))
        }
        channels = {key: value for key, value in channels.items() if value is not None}
        if not channels:
            continue
        lux = channels.get("in_illuminance_input")
        if lux is None and "in_illuminance_raw" in channels:
            raw = channels["in_illuminance_raw"]
            scale = channels.get("in_illuminance_scale", 1)
            offset = channels.get("in_illuminance_offset", 0)
            lux = (raw + offset) * scale
        result.append(
            {
                "id": device.name,
                "name": read_text(device / "name") or device.name,
                "illuminance_lx": lux,
                "channels": channels,
            }
        )
    return result


def collect_thermal(sys_root: Path) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for zone in sorted((sys_root / "class/thermal").glob("thermal_zone*")):
        raw = number(read_text(zone / "temp"))
        result.append(
            {
                "id": zone.name,
                "name": read_text(zone / "type") or zone.name,
                "temperature_c": raw / 1000 if isinstance(raw, (int, float)) else None,
            }
        )
    for hwmon in sorted((sys_root / "class/hwmon").glob("hwmon*")):
        chip = read_text(hwmon / "name") or hwmon.name
        for source in sorted(hwmon.glob("temp*_input")):
            raw = number(read_text(source))
            index = source.name.removeprefix("temp").removesuffix("_input")
            result.append(
                {
                    "id": f"{hwmon.name}_temp{index}",
                    "name": read_text(hwmon / f"temp{index}_label") or f"{chip} temp {index}",
                    "temperature_c": raw / 1000 if isinstance(raw, (int, float)) else None,
                }
            )
    return result


def collect_power_supplies(sys_root: Path) -> list[dict[str, Any]]:
    supplies: list[dict[str, Any]] = []
    for supply in sorted((sys_root / "class/power_supply").glob("*")):
        values: dict[str, Any] = {}
        for item in supply.iterdir():
            if not item.is_file() or item.name in {"uevent"}:
                continue
            text = read_text(item)
            if text is None or len(text) > 256:
                continue
            values[item.name] = number(text) if number(text) is not None else text
        normalized: dict[str, Any] = {}
        for source, (divisor, target) in MICRO_FIELDS.items():
            value = values.get(source)
            if isinstance(value, (int, float)):
                normalized[target] = value / divisor
        if (
            "power_w" not in normalized
            and isinstance(normalized.get("voltage_v"), (int, float))
            and isinstance(normalized.get("current_a"), (int, float))
        ):
            normalized["power_w"] = abs(normalized["voltage_v"] * normalized["current_a"])
        supplies.append(
            {"id": supply.name, "type": values.get("type", "Unknown"), "values": values, **normalized}
        )
    return supplies


def collect_backlights(sys_root: Path) -> list[dict[str, Any]]:
    result = []
    for item in sorted((sys_root / "class/backlight").glob("*")):
        brightness = number(read_text(item / "brightness"))
        maximum = number(read_text(item / "max_brightness"))
        result.append(
            {
                "id": item.name,
                "brightness": brightness,
                "max_brightness": maximum,
                "percent": round(brightness * 100 / maximum, 2)
                if isinstance(brightness, (int, float)) and isinstance(maximum, (int, float)) and maximum
                else None,
                "actual_brightness": number(read_text(item / "actual_brightness")),
                "bl_power": number(read_text(item / "bl_power")),
            }
        )
    return result


def collect_storage(sys_root: Path, enable_smart: bool) -> dict[str, Any]:
    mounts = []
    for partition in psutil.disk_partitions(all=False):
        # Snap packages are read-only squashfs loop mounts that always read 100 % "used".
        if partition.fstype in {"squashfs", "overlay", "tmpfs"} or partition.device.startswith("/dev/loop"):
            continue
        try:
            usage = psutil.disk_usage(partition.mountpoint)
        except (OSError, PermissionError):
            continue
        mounts.append(
            {
                "device": partition.device,
                "mountpoint": partition.mountpoint,
                "filesystem": partition.fstype,
                "total_bytes": usage.total,
                "used_bytes": usage.used,
                "free_bytes": usage.free,
                "percent": usage.percent,
            }
        )
    io = psutil.disk_io_counters(perdisk=True) or {}
    block = []
    smartctl = shutil.which("smartctl") if enable_smart else None
    for device in sorted((sys_root / "class/block").glob("*")):
        name = device.name
        if (device / "partition").exists() or name.startswith(("loop", "ram", "zram")):
            continue
        entry: dict[str, Any] = {
            "id": name,
            "model": read_text(device / "device/model"),
            "vendor": read_text(device / "device/vendor"),
            "serial": read_text(device / "device/serial"),
            "rotational": number(read_text(device / "queue/rotational")),
            "size_bytes": (number(read_text(device / "size")) or 0) * 512,
        }
        stats = io.get(name)
        if stats:
            entry["io"] = {
                "read_bytes": stats.read_bytes,
                "write_bytes": stats.write_bytes,
                "read_count": stats.read_count,
                "write_count": stats.write_count,
                "busy_time_ms": stats.busy_time,
            }
        if smartctl and name.startswith(("sd", "nvme", "mmcblk")):
            try:
                report = subprocess.run(
                    [smartctl, "-j", "-H", "-A", f"/dev/{name}"],
                    capture_output=True,
                    text=True,
                    timeout=8,
                    check=False,
                )
                parsed = json.loads(report.stdout or "{}")
                entry["smart"] = {
                    "passed": parsed.get("smart_status", {}).get("passed"),
                    "temperature_c": parsed.get("temperature", {}).get("current"),
                    "power_on_hours": parsed.get("power_on_time", {}).get("hours"),
                }
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
                entry["smart"] = {"available": False}
        block.append(entry)
    return {"mounts": mounts, "block_devices": block}


def collect_cameras(sys_root: Path) -> list[dict[str, Any]]:
    cameras = []
    v4l2ctl = shutil.which("v4l2-ctl")
    for item in sorted((sys_root / "class/video4linux").glob("video*")):
        # UVC cameras expose a capture node (index 0) and a metadata node (index 1); keep capture only.
        if number(read_text(item / "index")) not in (None, 0):
            continue
        device = f"/dev/{item.name}"
        camera = {
            "id": item.name,
            "name": read_text(item / "name") or item.name,
            "device": device,
            "driver": read_text(item / "device/driver/module/drivers"),
        }
        if v4l2ctl and Path(device).exists():
            try:
                report = subprocess.run(
                    [v4l2ctl, "--device", device, "--all", "--list-formats-ext"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
                camera["v4l2_capabilities"] = report.stdout[:32_000]
            except (OSError, subprocess.SubprocessError):
                camera["v4l2_capabilities"] = ""
        cameras.append(camera)
    return cameras


def collect_udev(max_devices: int) -> list[dict[str, Any]]:
    try:
        import pyudev
    except ImportError:
        return []
    allowed = {
        "ID_VENDOR",
        "ID_VENDOR_ID",
        "ID_MODEL",
        "ID_MODEL_ID",
        "ID_SERIAL_SHORT",
        "ID_PATH",
        "ID_BUS",
        "ID_TYPE",
        "ID_INPUT",
        "ID_INPUT_TOUCHSCREEN",
        "ID_INPUT_ACCELEROMETER",
    }
    devices = []
    for index, device in enumerate(pyudev.Context().list_devices()):
        if index >= max_devices:
            break
        properties = {
            key.lower(): json_value(device.properties.get(key))
            for key in allowed
            if device.properties.get(key) is not None
        }
        devices.append(
            {
                "sys_name": device.sys_name,
                "sys_path": device.sys_path,
                "subsystem": device.subsystem,
                "device_node": device.device_node,
                "device_type": device.device_type,
                "driver": device.driver,
                "properties": properties,
            }
        )
    return devices


def _cpu_temperature(thermal: list[dict[str, Any]]) -> float | None:
    """The CPU package temperature: x86_pkg_temp zone, else coretemp "Package id 0", else hottest core."""

    def pick(predicate) -> float | None:
        values = [
            item["temperature_c"]
            for item in thermal
            if item.get("temperature_c") is not None and predicate(str(item.get("name", "")))
        ]
        return max(values) if values else None

    return (
        pick(lambda name: name == "x86_pkg_temp")
        or pick(lambda name: name.lower().startswith("package id"))
        or pick(lambda name: name.lower().startswith("core"))
    )


def flatten_measurements(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """
    The curated sensors published to Home Assistant.

    Keys are the entities' unique ids, and the names decide their entity ids, so existing keys
    (system_cpu_percent, storage__used, energy_current_power, ...) must not be renamed: the watch
    face and HA dashboards bind to the resulting entity ids.
    """
    system = snapshot.get("system", {})
    cpu = system.get("cpu", {})
    result: dict[str, dict[str, Any]] = {
        "system_uptime": {
            "name": "System uptime",
            "value": system.get("uptime_seconds"),
            "unit": "s",
            "device_class": "duration",
        },
        "system_cpu_percent": {"name": "Cpu percent", "value": cpu.get("percent"), "unit": "%"},
        "system_cpu_load_1m": {"name": "Cpu load 1m", "value": cpu.get("load_1m")},
        "system_memory_percent": {
            "name": "Memory percent",
            "value": system.get("memory", {}).get("percent"),
            "unit": "%",
        },
        "system_swap_percent": {
            "name": "Swap percent",
            "value": system.get("swap", {}).get("percent"),
            "unit": "%",
        },
        "cpu_temperature": {
            "name": "CPU temperature",
            "value": _cpu_temperature(snapshot.get("thermal", [])),
            "unit": "°C",
            "device_class": "temperature",
        },
    }
    light = next(
        (
            item["illuminance_lx"]
            for item in snapshot.get("iio", [])
            if item.get("illuminance_lx") is not None
        ),
        None,
    )
    if light is not None:
        result["ambient_light"] = {
            "name": "Ambient light",
            "value": round(light, 1),
            "unit": "lx",
            "device_class": "illuminance",
        }
    battery = next(
        (
            item
            for item in snapshot.get("power_supplies", [])
            if str(item.get("type", "")).lower() == "battery"
        ),
        None,
    )
    if battery and isinstance(battery.get("values", {}).get("capacity"), (int, float)):
        result["battery_level"] = {
            "name": "Battery level",
            "value": battery["values"]["capacity"],
            "unit": "%",
            "device_class": "battery",
        }
    root = next(
        (mount for mount in snapshot.get("storage", {}).get("mounts", []) if mount.get("mountpoint") == "/"),
        None,
    )
    if root:
        result[f"storage_{slug('/')}_used"] = {
            "name": "Disk / used",
            "value": root.get("percent"),
            "unit": "%",
        }
    smart = [
        disk["smart"]
        for disk in snapshot.get("storage", {}).get("block_devices", [])
        if isinstance(disk.get("smart"), dict) and "passed" in disk["smart"]
    ]
    if smart:
        result["disk_health"] = {
            "name": "Disk health",
            "value": "ok" if all(item.get("passed") for item in smart) else "failing",
        }
    energy = snapshot.get("energy", {})
    result["energy_current_power"] = {
        "name": "Q775 current power",
        "value": energy.get("power_w"),
        "unit": "W",
        "device_class": "power",
    }
    result["energy_power_source"] = {
        "name": "Q775 power measurement source",
        "value": energy.get("source", "unavailable"),
    }
    return result


def collect_fast(config: CollectorConfig) -> dict[str, Any]:
    root = config.sys_root
    return {
        "system": collect_system(),
        "iio": collect_iio(root),
        "thermal": collect_thermal(root),
        "power_supplies": collect_power_supplies(root),
        "backlights": collect_backlights(root),
        "storage": collect_storage(root, False),
    }


def collect_slow(config: CollectorConfig) -> dict[str, Any]:
    return {
        "storage": collect_storage(config.sys_root, config.enable_smart),
        "cameras": collect_cameras(config.sys_root),
        "device_tree": collect_udev(config.max_udev_devices) if config.enable_udev else [],
    }
