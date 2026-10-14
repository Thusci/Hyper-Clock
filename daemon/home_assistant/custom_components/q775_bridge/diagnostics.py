from homeassistant.components.diagnostics import async_redact_data

from . import Q775ConfigEntry
from .const import CONF_TOKEN


async def async_get_config_entry_diagnostics(hass, entry: Q775ConfigEntry) -> dict:
    return {
        "config": async_redact_data(dict(entry.data), {CONF_TOKEN}),
        "snapshot": entry.runtime_data.coordinator.data,
    }
