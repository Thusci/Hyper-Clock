from pathlib import Path

from q775_daemon.collectors import (
    collect_backlights,
    collect_cameras,
    collect_iio,
    collect_power_supplies,
    collect_thermal,
    flatten_measurements,
)
from q775_daemon.config import CollectorConfig, DisplayConfig, PowerConfig
from q775_daemon.display import Backlight
from q775_daemon.inputs import key_devices
from q775_daemon.power import PowerSampler
from q775_daemon.sleep import SleepController


def write(root: Path, relative: str, value: str = "") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def test_linux_sysfs_collectors(tmp_path: Path) -> None:
    write(tmp_path, "bus/iio/devices/iio_device0/name", "als")
    write(tmp_path, "bus/iio/devices/iio_device0/in_illuminance_raw", "120")
    write(tmp_path, "bus/iio/devices/iio_device0/in_illuminance_scale", "0.5")
    # Motion sensors are present on the Q775 but deliberately not collected.
    write(tmp_path, "bus/iio/devices/iio_device1/name", "accel_3d")
    write(tmp_path, "bus/iio/devices/iio_device1/in_accel_x_raw", "-10431")
    write(tmp_path, "class/thermal/thermal_zone0/type", "x86_pkg_temp")
    write(tmp_path, "class/thermal/thermal_zone0/temp", "42500")
    write(tmp_path, "class/power_supply/BAT0/type", "Battery")
    write(tmp_path, "class/power_supply/BAT0/capacity", "73")
    write(tmp_path, "class/power_supply/BAT0/voltage_now", "12000000")
    write(tmp_path, "class/power_supply/BAT0/current_now", "500000")
    write(tmp_path, "class/backlight/intel_backlight/brightness", "50")
    write(tmp_path, "class/backlight/intel_backlight/max_brightness", "100")
    write(tmp_path, "class/video4linux/video0/name", "Q775 Front Camera")
    write(tmp_path, "class/video4linux/video0/index", "0")
    write(tmp_path, "class/video4linux/video1/name", "Q775 Front Camera")
    write(tmp_path, "class/video4linux/video1/index", "1")

    iio = collect_iio(tmp_path)
    assert len(iio) == 1 and iio[0]["illuminance_lx"] == 60
    assert collect_thermal(tmp_path)[0]["temperature_c"] == 42.5
    power = collect_power_supplies(tmp_path)
    assert power[0]["voltage_v"] == 12 and power[0]["power_w"] == 6
    assert collect_backlights(tmp_path)[0]["percent"] == 50
    cameras = collect_cameras(tmp_path)
    assert [camera["device"] for camera in cameras] == ["/dev/video0"]


def test_curated_measurements_keep_stable_keys() -> None:
    measurements = flatten_measurements(
        {
            "system": {
                "uptime_seconds": 20,
                "cpu": {"percent": 12.5, "load_1m": 0.4, "frequency_mhz": 1300},
                "memory": {"percent": 40},
                "swap": {"percent": 5},
            },
            "thermal": [
                {"id": "z0", "name": "x86_pkg_temp", "temperature_c": 47},
                {"id": "w", "name": "iwlwifi_1", "temperature_c": 64},
            ],
            "iio": [{"id": "als", "name": "acpi-als", "illuminance_lx": 3}],
            "power_supplies": [{"id": "CMB1", "type": "Battery", "values": {"capacity": 93}}],
            "storage": {
                "mounts": [{"mountpoint": "/", "percent": 92.7}],
                "block_devices": [{"smart": {"passed": True}}],
            },
            "energy": {"power_w": 4.2, "source": "intel_rapl"},
        }
    )
    # Keys bound by the watch face and HA dashboards must not change.
    for key in (
        "system_uptime",
        "system_cpu_percent",
        "system_memory_percent",
        "system_swap_percent",
        "storage__used",
        "energy_current_power",
    ):
        assert key in measurements
    assert measurements["cpu_temperature"]["value"] == 47
    assert measurements["ambient_light"]["unit"] == "lx"
    assert measurements["battery_level"]["value"] == 93
    assert measurements["disk_health"]["value"] == "ok"
    assert not any("frequency" in key for key in measurements)


def test_backlight_power_and_brightness(tmp_path: Path) -> None:
    write(tmp_path, "class/backlight/acpi_video0/type", "firmware")
    write(tmp_path, "class/backlight/acpi_video0/brightness", "5")
    write(tmp_path, "class/backlight/acpi_video0/max_brightness", "10")
    write(tmp_path, "class/backlight/intel_backlight/type", "raw")
    write(tmp_path, "class/backlight/intel_backlight/brightness", "600")
    write(tmp_path, "class/backlight/intel_backlight/max_brightness", "1000")
    write(tmp_path, "class/backlight/intel_backlight/bl_power", "0")
    light = Backlight(tmp_path, DisplayConfig())
    assert light.state()["backlight"] == "intel_backlight"
    assert light.set_power(False)["on"] is False
    assert (tmp_path / "class/backlight/intel_backlight/bl_power").read_text() == "4"
    state = light.set_power(True)
    assert state["on"] is True and state["brightness_percent"] == 60
    assert light.set_brightness(2)["brightness_percent"] == 5  # clamped to min_brightness_percent


def test_backlight_without_bl_power_restores_brightness(tmp_path: Path) -> None:
    write(tmp_path, "class/backlight/intel_backlight/brightness", "800")
    write(tmp_path, "class/backlight/intel_backlight/max_brightness", "1000")
    light = Backlight(tmp_path, DisplayConfig())
    light.set_power(False)
    assert (tmp_path / "class/backlight/intel_backlight/brightness").read_text() == "0"
    light.set_power(True)
    assert (tmp_path / "class/backlight/intel_backlight/brightness").read_text() == "800"


def test_key_devices_only_keyboard_class(tmp_path: Path) -> None:
    proc = tmp_path / "devices"
    proc.write_text(
        'I: Bus=0019\nN: Name="Intel HID events"\nH: Handlers=kbd event5\nB: EV=13\n\n'
        'I: Bus=0018\nN: Name="Wacom touchscreen"\nH: Handlers=mouse0 event7\nB: EV=b\n\n'
        'I: Bus=0011\nN: Name="AT Translated Set 2 keyboard"\n'
        "H: Handlers=sysrq kbd event3 leds\nB: EV=120013\n",
        encoding="utf-8",
    )
    assert key_devices(proc) == ["/dev/input/event5", "/dev/input/event3"]


def test_wifi_discovery_for_wake_on_wlan(tmp_path: Path) -> None:
    write(tmp_path, "class/net/lo/address", "00:00:00:00:00:00")
    write(tmp_path, "class/net/wlp1s0/address", "a4:34:d9:00:11:22")
    (tmp_path / "class/net/wlp1s0/wireless").mkdir(parents=True)
    wifi = SleepController(tmp_path, PowerConfig()).wifi()
    assert wifi["interface"] == "wlp1s0" and wifi["mac"] == "a4:34:d9:00:11:22"


def test_power_source_prefers_rapl_on_ac() -> None:
    sampler = PowerSampler(CollectorConfig(enable_powertop=False))
    on_ac = [{"type": "Battery", "values": {"status": "Not charging"}, "power_w": 0.0}]
    assert sampler.sample(on_ac)["source"] != "battery"
    on_battery = [{"type": "Battery", "values": {"status": "Discharging"}, "power_w": 6.4}]
    assert sampler.sample(on_battery) == {**sampler.sample(on_battery), "source": "battery", "power_w": 6.4}
