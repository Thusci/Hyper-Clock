from __future__ import annotations

import aiohttp
from aiohttp import web
from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_aiohttp_proxy_web, async_get_clientsession
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import Q775ConfigEntry
from .entity import Q775Entity


async def async_setup_entry(hass, entry: Q775ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    cameras = entry.runtime_data.coordinator.data.get("cameras", [])
    # Daemon 0.2 reports one capture node per physical camera; retire the old metadata-node duplicates.
    current = {f"{entry.entry_id}_camera_{item['id']}" for item in cameras}
    registry = er.async_get(hass)
    for item in er.async_entries_for_config_entry(registry, entry.entry_id):
        if (
            item.domain == "camera"
            and item.unique_id.startswith(f"{entry.entry_id}_camera_")
            and item.unique_id not in current
        ):
            registry.async_remove(item.entity_id)
    async_add_entities([Q775Camera(entry, item) for item in cameras])


class Q775Camera(Q775Entity, Camera):
    _attr_supported_features = CameraEntityFeature.STREAM

    def __init__(self, entry: Q775ConfigEntry, camera: dict) -> None:
        Q775Entity.__init__(self, entry)
        Camera.__init__(self)
        self.camera_id = camera["id"]
        self._attr_unique_id = f"{entry.entry_id}_camera_{self.camera_id}"
        self._attr_name = camera.get("name", self.camera_id)

    async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
        client = self.entry.runtime_data.client
        try:
            async with async_get_clientsession(self.hass).get(
                client.camera_url(self.camera_id),
                headers=client.headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                return await response.read() if response.status == 200 else None
        except (aiohttp.ClientError, TimeoutError):
            return None

    async def handle_async_mjpeg_stream(self, request: web.Request) -> web.StreamResponse | None:
        client = self.entry.runtime_data.client
        stream = async_get_clientsession(self.hass).get(
            client.camera_url(self.camera_id, True),
            headers=client.headers,
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=10),
        )
        return await async_aiohttp_proxy_web(self.hass, request, stream, timeout=10)
