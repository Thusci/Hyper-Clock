from __future__ import annotations

import asyncio
import contextlib
import hmac
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from aiohttp import WSMsgType, web

from . import __version__
from .camera import CameraError, CameraManager
from .collectors import collect_fast, collect_slow, flatten_measurements
from .config import Config
from .display import Backlight, DisplayError
from .inputs import InputWatcher
from .power import PowerSampler
from .sleep import SleepController, SleepError


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


class StateStore:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.power = PowerSampler(config.collectors)
        self.backlight = Backlight(config.collectors.sys_root, config.display)
        self.sleep = SleepController(config.collectors.sys_root, config.power)
        self.inputs = (
            InputWatcher(config.input.wake_keys, self.on_wake_key) if config.input.wake_on_keys else None
        )
        self.snapshot: dict[str, Any] = {"schema": 2, "sequence": 0, "timestamp": utc_now()}
        self.clients: set[web.WebSocketResponse] = set()
        self._tasks: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        await self.refresh_slow()
        await self.refresh_fast()
        self._tasks = [asyncio.create_task(self.telemetry_loop()), asyncio.create_task(self.device_loop())]
        if self.inputs:
            self.inputs.start()

    # ── control ───────────────────────────────────────────────────────────────
    async def publish_display(self) -> dict[str, Any]:
        """Push a display change at once instead of waiting for the next telemetry tick."""
        state = self.backlight.state()
        self.snapshot["display"] = state
        await self.broadcast({"type": "telemetry", "data": {"display": state, "timestamp": utc_now()}})
        return state

    async def on_wake_key(self, code: int) -> None:
        if not self.backlight.state().get("on", True):
            with contextlib.suppress(DisplayError):
                self.backlight.set_power(True)
                await self.publish_display()
        await self.broadcast({"type": "input", "data": {"key": code, "timestamp": utc_now()}})

    async def on_resume(self) -> None:
        with contextlib.suppress(DisplayError):
            self.backlight.set_power(True)
        await self.refresh_fast()
        self.snapshot["power_control"] = {
            **self.snapshot.get("power_control", {}),
            "last_sleep": self.sleep.last_sleep,
        }
        await self.broadcast({"type": "snapshot", "data": self.snapshot})

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if self.inputs:
            await self.inputs.stop()
        for client in tuple(self.clients):
            await client.close(code=1001, message=b"service stopping")

    async def refresh_fast(self) -> None:
        data = await asyncio.to_thread(collect_fast, self.config.collectors)
        previous_disks = {
            item.get("id"): item for item in self.snapshot.get("storage", {}).get("block_devices", [])
        }
        for disk in data.get("storage", {}).get("block_devices", []):
            previous = previous_disks.get(disk.get("id"), {})
            if "smart" in previous:
                disk["smart"] = previous["smart"]
        data["energy"] = self.power.sample(data["power_supplies"])
        data["display"] = self.backlight.state()
        merged = {
            **self.snapshot,
            **data,
            "schema": 1,
            "sequence": int(self.snapshot.get("sequence", 0)) + 1,
            "timestamp": utc_now(),
        }
        merged["measurements"] = flatten_measurements(merged)
        self.snapshot = merged

    async def refresh_slow(self) -> None:
        data = await asyncio.to_thread(collect_slow, self.config.collectors)
        if not self.config.camera.enabled:
            data["cameras"] = []
        data["power_control"] = {
            "wowlan": await self.sleep.wowlan_status(),
            "wifi": self.sleep.wifi(),
            "last_sleep": self.sleep.last_sleep,
            "allow_suspend": self.config.power.allow_suspend,
        }
        self.snapshot = {**self.snapshot, **data, "timestamp": utc_now()}

    async def telemetry_loop(self) -> None:
        while True:
            started = time.monotonic()
            await self.refresh_fast()
            telemetry_keys = (
                "schema",
                "sequence",
                "timestamp",
                "system",
                "iio",
                "thermal",
                "power_supplies",
                "backlights",
                "storage",
                "energy",
                "display",
                "measurements",
            )
            telemetry = {key: self.snapshot.get(key) for key in telemetry_keys}
            await self.broadcast({"type": "telemetry", "data": telemetry})
            await asyncio.sleep(
                max(0.1, self.config.server.telemetry_interval_seconds - (time.monotonic() - started))
            )

    async def device_loop(self) -> None:
        while True:
            await asyncio.sleep(self.config.server.device_refresh_seconds)
            await self.refresh_slow()
            await self.broadcast(
                {
                    "type": "device_tree",
                    "data": {
                        "timestamp": self.snapshot["timestamp"],
                        "cameras": self.snapshot.get("cameras", []),
                        "device_tree": self.snapshot.get("device_tree", []),
                        "storage": self.snapshot.get("storage", {}),
                    },
                }
            )

    async def broadcast(self, payload: dict[str, Any]) -> None:
        stale = []
        for client in tuple(self.clients):
            try:
                await client.send_json(payload)
            except (ConnectionError, RuntimeError):
                stale.append(client)
        self.clients.difference_update(stale)


@web.middleware
async def security_middleware(request: web.Request, handler):
    if request.path == "/health":
        return await handler(request)
    config: Config = request.app["config"]
    authorization = request.headers.get("Authorization", "")
    supplied = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied, config.server.token):
        raise web.HTTPUnauthorized(headers={"WWW-Authenticate": "Bearer"})
    origin = request.headers.get("Origin")
    if origin and config.server.allowed_origins and origin not in config.server.allowed_origins:
        raise web.HTTPForbidden(text="origin not allowed")
    return await handler(request)


async def health(request: web.Request) -> web.Response:
    store: StateStore = request.app["store"]
    return web.json_response(
        {
            "status": "ok",
            "service": "q775-sensor-daemon",
            "version": __version__,
            "sequence": store.snapshot.get("sequence", 0),
            "timestamp": utc_now(),
        }
    )


async def snapshot(request: web.Request) -> web.Response:
    return web.json_response(request.app["store"].snapshot)


async def devices(request: web.Request) -> web.Response:
    state = request.app["store"].snapshot
    return web.json_response(
        {
            "timestamp": state.get("timestamp"),
            "device_tree": state.get("device_tree", []),
            "cameras": state.get("cameras", []),
            "storage": state.get("storage", {}),
        }
    )


async def websocket(request: web.Request) -> web.WebSocketResponse:
    store: StateStore = request.app["store"]
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=1_048_576)
    await ws.prepare(request)
    store.clients.add(ws)
    await ws.send_json({"type": "hello", "schema": 1, "version": __version__, "timestamp": utc_now()})
    await ws.send_json({"type": "snapshot", "data": store.snapshot})
    try:
        async for message in ws:
            if message.type == WSMsgType.TEXT:
                if message.data == "ping":
                    await ws.send_str("pong")
                else:
                    with contextlib.suppress(ValueError, TypeError):
                        payload = message.json()
                        if payload.get("type") == "get_snapshot":
                            await ws.send_json({"type": "snapshot", "data": store.snapshot})
            elif message.type == WSMsgType.ERROR:
                break
    finally:
        store.clients.discard(ws)
    return ws


async def state(request: web.Request) -> web.Response:
    """Compact state for controllers: screen, power, wake sources and the curated measurements."""
    store: StateStore = request.app["store"]
    snap = store.snapshot
    return web.json_response(
        {
            "timestamp": snap.get("timestamp"),
            "display": store.backlight.state(),
            "power_control": snap.get("power_control", {}),
            "measurements": {key: item.get("value") for key, item in snap.get("measurements", {}).items()},
        }
    )


async def _json(request: web.Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except (ValueError, TypeError) as error:
        raise web.HTTPBadRequest(text="expected a JSON body") from error
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="expected a JSON object")
    return body


async def display(request: web.Request) -> web.Response:
    """{"power": "on" | "off" | "toggle"} and/or {"brightness": 5–100}."""
    store: StateStore = request.app["store"]
    body = await _json(request)
    try:
        if "brightness" in body:
            value = body["brightness"]
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise web.HTTPBadRequest(text="brightness must be a number")
            store.backlight.set_brightness(value)
        power = body.get("power")
        if power == "toggle":
            store.backlight.toggle()
        elif power in ("on", "off"):
            store.backlight.set_power(power == "on")
        elif power is not None:
            raise web.HTTPBadRequest(text="power must be on, off or toggle")
    except DisplayError as error:
        raise web.HTTPServiceUnavailable(text=str(error)) from error
    return web.json_response(await store.publish_display())


async def sleep(request: web.Request) -> web.Response:
    """Suspend the tablet. Optional {"wake_at": ISO-8601} or {"wake_in_minutes": n} arms the RTC."""
    store: StateStore = request.app["store"]
    body = await _json(request) if request.can_read_body else {}
    wake_at = None
    try:
        if body.get("wake_at"):
            wake_at = datetime.fromisoformat(str(body["wake_at"]))
            if wake_at.tzinfo is None:
                wake_at = wake_at.astimezone()
        elif body.get("wake_in_minutes") is not None:
            wake_at = datetime.now(UTC) + timedelta(minutes=float(body["wake_in_minutes"]))
    except (TypeError, ValueError) as error:
        raise web.HTTPBadRequest(text="invalid wake time") from error
    try:
        result = store.sleep.schedule_suspend(wake_at, store.on_resume)
    except SleepError as error:
        raise web.HTTPConflict(text=str(error)) from error
    return web.json_response(result, status=202)


async def wake(request: web.Request) -> web.Response:
    """Screen on. (Waking from suspend has to come from outside: Wake-on-WLAN, RTC or the power button.)"""
    store: StateStore = request.app["store"]
    try:
        store.backlight.set_power(True)
    except DisplayError as error:
        raise web.HTTPServiceUnavailable(text=str(error)) from error
    return web.json_response(await store.publish_display())


async def camera_snapshot(request: web.Request) -> web.Response:
    store: StateStore = request.app["store"]
    manager: CameraManager = request.app["camera"]
    try:
        device = manager.resolve(request.match_info["camera_id"], store.snapshot.get("cameras", []))
        image = await manager.snapshot(device)
    except CameraError as error:
        raise web.HTTPServiceUnavailable(text=str(error)) from error
    return web.Response(body=image, content_type="image/jpeg", headers={"Cache-Control": "no-store"})


async def camera_stream(request: web.Request) -> web.StreamResponse:
    store: StateStore = request.app["store"]
    manager: CameraManager = request.app["camera"]
    try:
        device = manager.resolve(request.match_info["camera_id"], store.snapshot.get("cameras", []))
    except CameraError as error:
        raise web.HTTPNotFound(text=str(error)) from error
    response = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "multipart/x-mixed-replace; boundary=q775frame",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )
    await response.prepare(request)
    try:
        async for frame in manager.frames(device):
            await response.write(
                b"--q775frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(frame)).encode()
                + b"\r\n\r\n"
                + frame
                + b"\r\n"
            )
    except (CameraError, ConnectionError, asyncio.CancelledError):
        pass
    return response


async def on_startup(app: web.Application) -> None:
    await app["store"].start()


async def on_cleanup(app: web.Application) -> None:
    await app["store"].stop()


def create_app(config: Config) -> web.Application:
    app = web.Application(middlewares=[security_middleware], client_max_size=1_048_576)
    app["config"] = config
    app["store"] = StateStore(config)
    app["camera"] = CameraManager(config.camera)
    app.add_routes(
        [
            web.get("/health", health),
            web.get("/api/v1/snapshot", snapshot),
            web.get("/api/v1/devices", devices),
            web.get("/api/v1/state", state),
            web.post("/api/v1/display", display),
            web.post("/api/v1/sleep", sleep),
            web.post("/api/v1/wake", wake),
            web.get("/ws", websocket),
            web.get("/camera/{camera_id}.jpg", camera_snapshot),
            web.get("/camera/{camera_id}.mjpeg", camera_stream),
        ]
    )
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app
