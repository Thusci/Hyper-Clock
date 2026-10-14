from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import Q775ConfigEntry
from .entity import Q775Entity


async def async_setup_entry(hass, entry: Q775ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([Q775ExternalPower(entry), Q775BatteryCharging(entry)])


class Q775ExternalPower(Q775Entity, BinarySensorEntity):
    _attr_name = "External power"
    _attr_device_class = BinarySensorDeviceClass.PLUG

    def __init__(self, entry: Q775ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_external_power"

    @property
    def is_on(self) -> bool | None:
        values = [
            item.get("values", {}).get("online")
            for item in self.coordinator.data.get("power_supplies", [])
            if str(item.get("type", "")).lower() != "battery"
        ]
        return any(int(value) == 1 for value in values if value is not None) if values else None


class Q775BatteryCharging(Q775Entity, BinarySensorEntity):
    _attr_name = "Battery charging"
    _attr_device_class = BinarySensorDeviceClass.BATTERY_CHARGING

    def __init__(self, entry: Q775ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_battery_charging"

    @property
    def is_on(self) -> bool | None:
        states = [
            str(item.get("values", {}).get("status", "")).lower()
            for item in self.coordinator.data.get("power_supplies", [])
            if str(item.get("type", "")).lower() == "battery"
        ]
        return any(state == "charging" for state in states) if states else None
