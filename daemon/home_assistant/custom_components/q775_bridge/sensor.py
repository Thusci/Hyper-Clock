from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity
from homeassistant.const import (
    LIGHT_LUX,
    PERCENTAGE,
    UnitOfElectricCurrent,
    UnitOfElectricPotential,
    UnitOfEnergy,
    UnitOfPower,
    UnitOfTemperature,
)
from homeassistant.core import callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import Q775ConfigEntry
from .entity import Q775Entity

UNITS = {
    "%": PERCENTAGE,
    "°C": UnitOfTemperature.CELSIUS,
    "lx": LIGHT_LUX,
    "W": UnitOfPower.WATT,
    "Wh": UnitOfEnergy.WATT_HOUR,
    "V": UnitOfElectricPotential.VOLT,
    "A": UnitOfElectricCurrent.AMPERE,
}


async def async_setup_entry(hass, entry: Q775ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    known: set[str] = set()
    _remove_retired_sensors(hass, entry)

    @callback
    def add_new() -> None:
        measurements = entry.runtime_data.coordinator.data.get("measurements", {})
        additions = [
            Q775Sensor(entry, key, metadata) for key, metadata in measurements.items() if key not in known
        ]
        known.update(item.key for item in additions)
        if additions:
            async_add_entities(additions)

    add_new()
    entry.async_on_unload(entry.runtime_data.coordinator.async_add_listener(add_new))


class Q775Sensor(Q775Entity, SensorEntity):
    def __init__(self, entry: Q775ConfigEntry, key: str, metadata: dict[str, Any]) -> None:
        super().__init__(entry)
        self.key = key
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_name = metadata.get("name", key)
        self._attr_native_unit_of_measurement = UNITS.get(metadata.get("unit"), metadata.get("unit"))
        self._attr_device_class = metadata.get("device_class")

    @property
    def native_value(self):
        return self.coordinator.data.get("measurements", {}).get(self.key, {}).get("value")


def _remove_retired_sensors(hass, entry: Q775ConfigEntry) -> None:
    """
    Daemon 0.2 publishes a curated sensor set. Sensors that 0.1 created (raw IIO axes, snap
    mounts, per-zone temperatures, ...) would otherwise linger as "unavailable" forever, so remove
    this entry's sensors whose key is no longer published. Kept keys keep their entity ids.
    """
    current = set(entry.runtime_data.coordinator.data.get("measurements", {}))
    if not current:
        return
    registry = er.async_get(hass)
    prefix = f"{entry.entry_id}_"
    for item in er.async_entries_for_config_entry(registry, entry.entry_id):
        if item.domain != "sensor" or not item.unique_id.startswith(prefix):
            continue
        if item.unique_id.removeprefix(prefix) not in current:
            registry.async_remove(item.entity_id)
