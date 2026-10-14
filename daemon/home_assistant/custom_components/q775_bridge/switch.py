from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import Q775ConfigEntry
from .api import Q775ApiError
from .entity import Q775Entity


async def async_setup_entry(hass, entry: Q775ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    if entry.runtime_data.coordinator.data.get("display", {}).get("available"):
        async_add_entities([Q775Screen(entry)])


class Q775Screen(Q775Entity, SwitchEntity):
    """The Q775 panel backlight. Off is instant and the system keeps running (the kiosk stays live)."""

    _attr_name = "Screen"
    _attr_icon = "mdi:tablet"

    def __init__(self, entry: Q775ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_screen"

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.data.get("display", {}).get("on")

    async def _set(self, power: str) -> None:
        try:
            await self.entry.runtime_data.client.async_command("display", {"power": power})
        except Q775ApiError as error:
            raise HomeAssistantError(f"Q775 screen: {error}") from error

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set("on")

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set("off")
