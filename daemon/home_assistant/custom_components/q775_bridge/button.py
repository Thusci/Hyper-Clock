from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import Q775ConfigEntry
from .api import Q775ApiError
from .entity import Q775Entity


async def async_setup_entry(hass, entry: Q775ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    entities: list[ButtonEntity] = [Q775WakeScreen(entry)]
    if entry.runtime_data.coordinator.data.get("power_control", {}).get("allow_suspend", True):
        entities.append(Q775Sleep(entry))
    async_add_entities(entities)


class Q775WakeScreen(Q775Entity, ButtonEntity):
    """Turn the screen on.

    To wake a suspended tablet, send `wake_on_lan.send_magic_packet` to the Wi-Fi MAC shown in
    this device's diagnostics (`power_control.wifi.mac`).
    """

    _attr_name = "Wake screen"
    _attr_icon = "mdi:monitor-shimmer"

    def __init__(self, entry: Q775ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_wake"

    async def async_press(self) -> None:
        try:
            await self.entry.runtime_data.client.async_command("wake")
        except Q775ApiError as error:
            raise HomeAssistantError(f"Q775 wake: {error}") from error


class Q775Sleep(Q775Entity, ButtonEntity):
    """Suspend the tablet. Wake it with a magic packet (Wake-on-WLAN is armed first) or the power button."""

    _attr_name = "Sleep"
    _attr_icon = "mdi:power-sleep"

    def __init__(self, entry: Q775ConfigEntry) -> None:
        super().__init__(entry)
        self._attr_unique_id = f"{entry.entry_id}_sleep"

    async def async_press(self) -> None:
        try:
            await self.entry.runtime_data.client.async_command("sleep")
        except Q775ApiError as error:
            raise HomeAssistantError(f"Q775 sleep: {error}") from error
