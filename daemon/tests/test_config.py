from pathlib import Path

import pytest

from q775_daemon.config import load_config


def test_config_requires_strong_token(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text('[server]\ntoken="short"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="24 random"):
        load_config(config)


def test_config_loads(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text('[server]\ntoken="abcdefghijklmnopqrstuvwxyz123456"\nport=9999\n', encoding="utf-8")
    loaded = load_config(config)
    assert loaded.server.port == 9999
    assert loaded.collectors.sys_root == Path("/sys")
