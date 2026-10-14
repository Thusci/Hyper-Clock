from __future__ import annotations

import asyncio
import csv
import os
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

from .config import CollectorConfig
from .util import number, read_text

POWER_PATTERN = re.compile(r"(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>[um]?W)\b", re.IGNORECASE)


class PowerSampler:
    def __init__(self, config: CollectorConfig) -> None:
        self.config = config
        self._rapl_previous: dict[str, tuple[float, float, float]] = {}
        self._powertop: dict[str, Any] = {"available": False, "reason": "not sampled"}
        self._powertop_task: asyncio.Task[None] | None = None
        self._last_powertop = 0.0

    def sample(self, supplies: list[dict[str, Any]]) -> dict[str, Any]:
        now = time.monotonic()
        rapl = self._sample_rapl(now)
        # Battery discharge is whole-system power, but only while running on battery: on AC the
        # battery current is ~0 A and would report 0 W. Then the RAPL package counter is the truth.
        battery = next((item for item in supplies if str(item.get("type", "")).lower() == "battery"), {})
        discharging = str(battery.get("values", {}).get("status", "")).lower() == "discharging"
        battery_w = battery.get("power_w")
        if discharging and isinstance(battery_w, (int, float)) and battery_w > 0:
            source, watts = "battery", abs(float(battery_w))
        elif rapl.get("package_power_w") is not None:
            source, watts = "intel_rapl", rapl["package_power_w"]
        elif self._powertop.get("component_estimate_sum_w") is not None:
            source, watts = "powertop_estimate", self._powertop["component_estimate_sum_w"]
        else:
            source, watts = "unavailable", None
        if (
            self.config.enable_powertop
            and now - self._last_powertop >= self.config.powertop_interval_seconds
            and (self._powertop_task is None or self._powertop_task.done())
        ):
            self._last_powertop = now
            self._powertop_task = asyncio.create_task(self._refresh_powertop())
        return {"power_w": watts, "source": source, "rapl": rapl, "powertop": self._powertop}

    def _sample_rapl(self, now: float) -> dict[str, Any]:
        domains = []
        total = 0.0
        measured = False
        root = self.config.sys_root / "class/powercap"
        for domain in sorted(root.glob("intel-rapl*")):
            energy = number(read_text(domain / "energy_uj"))
            maximum = number(read_text(domain / "max_energy_range_uj"))
            if not isinstance(energy, (int, float)) or not isinstance(maximum, (int, float)):
                continue
            name = read_text(domain / "name") or domain.name
            power = None
            previous = self._rapl_previous.get(str(domain))
            if previous:
                old_energy, old_time, old_max = previous
                delta = energy - old_energy if energy >= old_energy else (old_max - old_energy) + energy
                elapsed = now - old_time
                if elapsed > 0:
                    power = delta / 1_000_000 / elapsed
                    total += power
                    measured = True
            self._rapl_previous[str(domain)] = (float(energy), now, float(maximum))
            domains.append({"id": domain.name, "name": name, "energy_uj": energy, "power_w": power})
        return {"package_power_w": round(total, 3) if measured else None, "domains": domains}

    async def _refresh_powertop(self) -> None:
        executable = shutil.which("powertop")
        if not executable:
            self._powertop = {"available": False, "reason": "powertop not installed"}
            return
        try:
            self._powertop = await asyncio.to_thread(self._run_powertop, executable)
        except Exception as error:  # noqa: BLE001 - retained as daemon diagnostics
            self._powertop = {"available": False, "reason": str(error)[:200]}

    def _run_powertop(self, executable: str) -> dict[str, Any]:
        fd, report_name = tempfile.mkstemp(prefix="q775-powertop-", suffix=".csv")
        os.close(fd)
        report = Path(report_name)
        try:
            process = __import__("subprocess").run(
                [
                    executable,
                    f"--csv={report}",
                    f"--time={self.config.powertop_sample_seconds}",
                    "--iteration=1",
                    "--quiet",
                ],
                capture_output=True,
                text=True,
                timeout=self.config.powertop_sample_seconds + 20,
                check=False,
                env={**os.environ, "LC_ALL": "C"},
            )
            if not report.exists() or report.stat().st_size == 0:
                raise RuntimeError((process.stderr or "powertop produced no report").strip()[:200])
            consumers: list[dict[str, Any]] = []
            total = 0.0
            with report.open(encoding="utf-8", errors="replace", newline="") as handle:
                for row in csv.reader(handle):
                    joined = " ".join(row)
                    match = POWER_PATTERN.search(joined)
                    if not match:
                        continue
                    watts = (
                        float(match.group("value"))
                        * {"uw": 0.000001, "mw": 0.001, "w": 1}[match.group("unit").lower()]
                    )
                    label = next(
                        (
                            cell.strip()
                            for cell in reversed(row)
                            if cell.strip() and not POWER_PATTERN.fullmatch(cell.strip())
                        ),
                        "unknown",
                    )
                    total += watts
                    consumers.append({"name": label[:160], "power_w": round(watts, 6)})
            consumers.sort(key=lambda item: item["power_w"], reverse=True)
            return {
                "available": True,
                "sample_seconds": self.config.powertop_sample_seconds,
                "component_estimate_sum_w": round(total, 4),
                "top_consumers": consumers[:20],
                "return_code": process.returncode,
            }
        finally:
            report.unlink(missing_ok=True)
