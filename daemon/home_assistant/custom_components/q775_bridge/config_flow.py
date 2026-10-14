from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import Q775ApiError, Q775Client
from .const import CONF_BASE_URL, CONF_TOKEN, DEFAULT_URL, DOMAIN


class Q775ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input:
            base_url = user_input[CONF_BASE_URL].rstrip("/")
            await self.async_set_unique_id(base_url)
            self._abort_if_unique_id_configured()
            client = Q775Client(async_get_clientsession(self.hass), base_url, user_input[CONF_TOKEN])
            try:
                snapshot = await client.async_snapshot()
            except Q775ApiError:
                errors["base"] = "cannot_connect"
            else:
                hostname = snapshot.get("system", {}).get("hostname", "Q775")
                return self.async_create_entry(
                    title=f"Q775 · {hostname}",
                    data={CONF_BASE_URL: base_url, CONF_TOKEN: user_input[CONF_TOKEN]},
                )
        schema = vol.Schema(
            {vol.Required(CONF_BASE_URL, default=DEFAULT_URL): str, vol.Required(CONF_TOKEN): str}
        )
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)
