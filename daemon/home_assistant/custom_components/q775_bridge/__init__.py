from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import Q775Client
from .const import CONF_BASE_URL, CONF_TOKEN, PLATFORMS
from .coordinator import Q775Coordinator


@dataclass
class Q775RuntimeData:
    client: Q775Client
    coordinator: Q775Coordinator


type Q775ConfigEntry = ConfigEntry[Q775RuntimeData]


async def async_setup_entry(hass: HomeAssistant, entry: Q775ConfigEntry) -> bool:
    client = Q775Client(async_get_clientsession(hass), entry.data[CONF_BASE_URL], entry.data[CONF_TOKEN])
    coordinator = Q775Coordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    client.start()
    entry.runtime_data = Q775RuntimeData(client, coordinator)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: Q775ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.coordinator.async_shutdown()
    return unloaded
