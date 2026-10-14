from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp


class Q775ApiError(RuntimeError):
    pass


class Q775Client:
    def __init__(self, session: aiohttp.ClientSession, base_url: str, token: str) -> None:
        self.session = session
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"}
        self.data: dict[str, Any] = {}
        self._listeners: set[Callable[[dict[str, Any]], None]] = set()
        self._task: asyncio.Task[None] | None = None
        self._stopping = False

    @property
    def websocket_url(self) -> str:
        parts = urlsplit(self.base_url)
        return urlunsplit(
            ("wss" if parts.scheme == "https" else "ws", parts.netloc, f"{parts.path}/ws", "", "")
        )

    async def async_snapshot(self) -> dict[str, Any]:
        try:
            async with self.session.get(
                f"{self.base_url}/api/v1/snapshot",
                headers=self.headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as response:
                if response.status != 200:
                    raise Q775ApiError(f"daemon returned HTTP {response.status}")
                self.data = await response.json()
                return self.data
        except (aiohttp.ClientError, TimeoutError) as error:
            raise Q775ApiError(str(error)) from error

    async def async_command(self, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """POST a control command (display, sleep, wake) to the daemon."""
        try:
            async with self.session.post(
                f"{self.base_url}/api/v1/{path}",
                headers=self.headers,
                json=payload or {},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as response:
                if response.status >= 400:
                    raise Q775ApiError(f"{path}: HTTP {response.status} {(await response.text())[:160]}")
                result = await response.json()
        except (aiohttp.ClientError, TimeoutError) as error:
            raise Q775ApiError(str(error)) from error
        if path in {"display", "wake"} and isinstance(result, dict):
            # Reflect the new screen state immediately; the WebSocket push follows.
            self.data = {**self.data, "display": result}
            for listener in tuple(self._listeners):
                listener(self.data)
        return result

    def add_listener(self, listener: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        self._listeners.add(listener)
        return lambda: self._listeners.discard(listener)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stopping = False
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopping = True
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _run(self) -> None:
        delay = 1
        while not self._stopping:
            try:
                async with self.session.ws_connect(
                    self.websocket_url, headers=self.headers, heartbeat=20, max_msg_size=16 * 1024 * 1024
                ) as socket:
                    delay = 1
                    async for message in socket:
                        if message.type != aiohttp.WSMsgType.TEXT:
                            continue
                        payload = message.json()
                        if payload.get("type") in {"snapshot", "telemetry", "device_tree"} and isinstance(
                            payload.get("data"), dict
                        ):
                            self.data = (
                                payload["data"]
                                if payload.get("type") == "snapshot"
                                else {**self.data, **payload["data"]}
                            )
                            for listener in tuple(self._listeners):
                                listener(self.data)
            except (aiohttp.ClientError, TimeoutError, Q775ApiError):
                await asyncio.sleep(delay)
                delay = min(delay * 2, 60)

    def camera_url(self, camera_id: str, stream: bool = False) -> str:
        return f"{self.base_url}/camera/{camera_id}.{'mjpeg' if stream else 'jpg'}"
