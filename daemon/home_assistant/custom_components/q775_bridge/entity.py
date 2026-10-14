from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import Q775ConfigEntry
from .const import DOMAIN
from .coordinator import Q775Coordinator


class Q775Entity(CoordinatorEntity[Q775Coordinator]):
    _attr_has_entity_name = True

    def __init__(self, entry: Q775ConfigEntry) -> None:
        super().__init__(entry.runtime_data.coordinator)
        self.entry = entry
        hostname = self.coordinator.data.get("system", {}).get("hostname", "Q775")
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name=f"Q775 {hostname}",
            manufacturer="Fujitsu",
            model="Stylistic Q775",
            sw_version=str(self.coordinator.data.get("schema", 1)),
        )
