from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.const import PERCENTAGE
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import Q775ConfigEntry
from .api import Q775ApiError
from .entity import Q775Entity


async def async_setup_entry(hass, entry: Q775ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    if entry.runtime_data.coordinator.data.get("display", {}).get("available"):
        async_add_entities([Q775Brightness(entry)])


class Q775Brightness(Q775Entity, NumberEntity):
    _attr_name = "Screen brightness"
    _attr_icon = "mdi:brightness-6"
    _attr_native_min_value = 5
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_mode = NumberMode.SLIDER

    def __init__(self, entry: Q775ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_screen_brightness"

    @property
    def native_value(self) -> float | None:
        return self.coordinator.data.get("display", {}).get("brightness_percent")

    async def async_set_native_value(self, value: float) -> None:
        try:
            await self.entry.runtime_data.client.async_command("display", {"brightness": value})
        except Q775ApiError as error:
            raise HomeAssistantError(f"Q775 brightness: {error}") from error
