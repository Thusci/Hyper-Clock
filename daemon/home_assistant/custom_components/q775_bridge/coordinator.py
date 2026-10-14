from __future__ import annotations

from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import Q775ApiError, Q775Client


class Q775Coordinator(DataUpdateCoordinator[dict]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: Q775Client) -> None:
        super().__init__(
            hass,
            logger=__import__("logging").getLogger(__name__),
            name="Q775 daemon",
            update_interval=timedelta(minutes=5),
            config_entry=entry,
        )
        self.client = client
        self._remove_listener = client.add_listener(self._handle_push)

    async def _async_update_data(self) -> dict:
        try:
            return await self.client.async_snapshot()
        except Q775ApiError as error:
            raise UpdateFailed(str(error)) from error

    @callback
    def _handle_push(self, data: dict) -> None:
        self.async_set_updated_data(data)

    async def async_shutdown(self) -> None:
        self._remove_listener()
        await self.client.stop()
