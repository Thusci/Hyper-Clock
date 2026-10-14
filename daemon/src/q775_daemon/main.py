from __future__ import annotations

import argparse
import logging
from pathlib import Path

from aiohttp import web

from .config import load_config
from .server import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Q775 sensor and camera bridge")
    parser.add_argument("--config", type=Path, default=Path("/etc/q775-daemon/config.toml"))
    parser.add_argument("--check", action="store_true", help="validate configuration and exit")
    args = parser.parse_args()
    config = load_config(args.config)
    if args.check:
        print(f"configuration valid: {args.config}")
        return
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    web.run_app(
        create_app(config),
        host=config.server.host,
        port=config.server.port,
        access_log_format='%a "%r" %s %Tf',
    )


if __name__ == "__main__":
    main()
