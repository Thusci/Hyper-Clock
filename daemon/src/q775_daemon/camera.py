from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

from .config import CameraConfig


class CameraError(RuntimeError):
    pass


class CameraManager:
    def __init__(self, config: CameraConfig) -> None:
        self.config = config
        self._slots = asyncio.Semaphore(config.max_streams)

    def resolve(self, camera_id: str, cameras: list[dict]) -> str:
        camera = next((item for item in cameras if item.get("id") == camera_id), None)
        if not camera:
            raise CameraError("camera not found")
        device = str(camera.get("device", ""))
        if not device.startswith("/dev/video") or not Path(device).exists():
            raise CameraError("camera device unavailable")
        return device

    def _command(self, device: str, frames: int | None = None) -> list[str]:
        command = [
            self.config.ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-f",
            "v4l2",
            "-framerate",
            str(self.config.fps),
            "-video_size",
            f"{self.config.width}x{self.config.height}",
            "-i",
            device,
        ]
        if frames is not None:
            command += ["-frames:v", str(frames)]
        return command + [
            "-an",
            "-c:v",
            "mjpeg",
            "-q:v",
            str(self.config.jpeg_quality),
            "-f",
            "mjpeg",
            "pipe:1",
        ]

    async def snapshot(self, device: str) -> bytes:
        async with self._slots:
            try:
                process = await asyncio.create_subprocess_exec(
                    *self._command(device, 1), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
            except OSError as error:
                raise CameraError(f"cannot start ffmpeg: {error}") from error
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
            except TimeoutError as error:
                process.kill()
                await process.wait()
                raise CameraError("camera snapshot timed out") from error
            if process.returncode or not stdout:
                raise CameraError((stderr.decode(errors="replace") or "camera returned no image")[:300])
            return stdout

    async def frames(self, device: str) -> AsyncIterator[bytes]:
        async with self._slots:
            try:
                process = await asyncio.create_subprocess_exec(
                    *self._command(device), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
            except OSError as error:
                raise CameraError(f"cannot start ffmpeg: {error}") from error
            if process.stdout is None:
                process.kill()
                await process.wait()
                raise CameraError("ffmpeg stdout pipe unavailable")
            buffer = b""
            try:
                while chunk := await process.stdout.read(65536):
                    buffer += chunk
                    while True:
                        start = buffer.find(b"\xff\xd8")
                        end = buffer.find(b"\xff\xd9", start + 2) if start >= 0 else -1
                        if start < 0 or end < 0:
                            if len(buffer) > 8_000_000:
                                buffer = buffer[-2:]
                            break
                        yield buffer[start : end + 2]
                        buffer = buffer[end + 2 :]
            finally:
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=2)
                    except TimeoutError:
                        process.kill()
                        await process.wait()
