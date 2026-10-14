from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import struct
from collections.abc import Awaitable, Callable
from pathlib import Path

log = logging.getLogger(__name__)

# struct input_event on 64-bit Linux: timeval (2 × long), type (u16), code (u16), value (s32).
EVENT = struct.Struct("llHHi")
EV_KEY = 0x01
KEY_PRESS = 1
RESCAN_SECONDS = 60


def key_devices(proc_file: Path = Path("/proc/bus/input/devices")) -> list[str]:
    """Event nodes of devices that report keys (the Q775's volume and Windows buttons, keyboards)."""
    try:
        text = proc_file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    nodes = []
    for block in text.split("\n\n"):
        handlers = re.search(r"^H: Handlers=(.*)$", block, re.MULTILINE)
        events = re.search(r"^B: EV=([0-9a-f]+)$", block, re.MULTILINE)
        if not handlers or not events or not int(events.group(1), 16) & (1 << EV_KEY):
            continue
        # Pointers and touchscreens also report EV_KEY (BTN_*); only keyboard-class handlers carry buttons.
        if "kbd" not in handlers.group(1).split():
            continue
        node = next((item for item in handlers.group(1).split() if item.startswith("event")), None)
        if node:
            nodes.append(f"/dev/input/{node}")
    return nodes


class InputWatcher:
    """
    Passively reads hardware button presses (no EVIOCGRAB, so Chromium still receives every key)
    and calls `on_press(code)` for the configured wake keys. This keeps "press any button to wake
    the screen" working at the kernel level, even if the browser or the web stack is stuck.
    """

    def __init__(self, keys: list[int], on_press: Callable[[int], Awaitable[None]]) -> None:
        self.keys = set(keys)
        self.on_press = on_press
        self._open: dict[str, int] = {}
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        loop = asyncio.get_running_loop()
        for fd in self._open.values():
            loop.remove_reader(fd)
            os.close(fd)
        self._open.clear()

    async def _run(self) -> None:
        while True:
            self._rescan()
            await asyncio.sleep(RESCAN_SECONDS)

    def _rescan(self) -> None:
        loop = asyncio.get_running_loop()
        wanted = set(key_devices())
        for path in list(self._open):
            if path not in wanted:
                self._close(path)
        for path in wanted - set(self._open):
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError as error:
                log.debug("cannot open %s: %s", path, error)
                continue
            self._open[path] = fd
            loop.add_reader(fd, self._readable, path)
            log.info("watching buttons on %s", path)

    def _close(self, path: str) -> None:
        fd = self._open.pop(path, None)
        if fd is not None:
            asyncio.get_running_loop().remove_reader(fd)
            with contextlib.suppress(OSError):
                os.close(fd)

    def _readable(self, path: str) -> None:
        fd = self._open.get(path)
        if fd is None:
            return
        try:
            data = os.read(fd, EVENT.size * 64)
        except BlockingIOError:
            return
        except OSError:
            self._close(path)  # device went away (e.g. across suspend); the next rescan reopens it
            return
        for offset in range(0, len(data) - EVENT.size + 1, EVENT.size):
            _, _, kind, code, value = EVENT.unpack_from(data, offset)
            if kind == EV_KEY and value == KEY_PRESS and code in self.keys:
                asyncio.get_running_loop().create_task(self.on_press(code))
