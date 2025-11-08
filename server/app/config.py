from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal

import yaml
from loguru import logger
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def deep_merge(base: Mapping[str, Any], overrides: Mapping[str, Any]) -> dict[str, Any]:
    """Recursively merge mappings so that values in overrides take precedence."""
    result = dict(base)
    for key, value in overrides.items():
        if isinstance(value, Mapping) and isinstance(result.get(key), Mapping):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


APP_DIR = Path(__file__).resolve().parent


class AppConfig(BaseSettings):
    """Constants, that user can't change"""

    project_name: str = "Mangarr"
    version: str = "2.0.0"
    config_dir: Path = APP_DIR.parent.parent / "config"
    log_dir: Path = config_dir / "log"
    static_root: Path = APP_DIR / "static"
    cors_allow_origins: list[str] = Field(default_factory=lambda: ["*"])
    cors_allow_origin_regex: str | None = None
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]

    @field_validator("config_dir")
    def ensure_config_dir(cls, v: Path):
        v.mkdir(parents=True, exist_ok=True)
        return v

    @field_validator("log_dir")
    def ensure_log_dir(cls, v: Path):
        v.mkdir(parents=True, exist_ok=True)
        return v

    @field_validator("static_root")
    def ensure_static_root(cls, v: Path):
        v.mkdir(parents=True, exist_ok=True)
        return v

    @property
    def config_path(self) -> Path:
        return self.config_dir / "config.yaml"

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.config_dir}/mangarr.db"

    model_config = SettingsConfigDict(
        env_prefix="",
        env_file=None,
    )


class ServerConfig(BaseSettings):
    """Server related configuration"""

    port: int = 3000
    model_config: Any = SettingsConfigDict(extra="ignore")


class LogConfig(BaseSettings):
    """Logs related configuration"""

    level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    rotation: str = "10 MB"  # bytes or time to automatically rotate
    retention: str | None = "14 days"  # optional cleanup policy
    access: bool = False  # access logs from middleware
    sql: bool = False  # log SQL queries sent to the database
    model_config: Any = SettingsConfigDict(extra="ignore")


class Settings(BaseSettings):
    """Application configuration loaded from environment"""

    app: AppConfig = AppConfig()
    server: ServerConfig = ServerConfig()
    log: LogConfig = LogConfig()

    model_config: Any = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        env_prefix="MANGARR__",
        env_nested_delimiter="__",
        extra="ignore",
    )


def update_config_file(settings: Settings) -> None:
    """Persist the latest settings values into the config file when they change."""
    config_path = settings.app.config_path
    with open(config_path) as f:
        current = yaml.safe_load(f) or {}
    updated = deep_merge(current, settings.model_dump(exclude={"app"}))
    if updated != current:
        with open(config_path, "w") as f:
            yaml.safe_dump(updated, f)
        logger.info(f"Config file {config_path} updated")


def load_settings() -> Settings:
    """Load settings by combining defaults, env overrides, and the YAML config file."""
    settings = Settings()
    config_path = settings.app.config_path

    if not config_path.exists():
        with open(config_path, "w") as f:
            yaml.safe_dump(settings.model_dump(exclude={"app"}), f)
        logger.info(f"Created config file: {config_path}")
    else:
        update_config_file(settings)

    with open(config_path) as f:
        file_settings = yaml.safe_load(f) or {}

    return Settings(**deep_merge(file_settings, settings.model_dump()))


settings = load_settings()
