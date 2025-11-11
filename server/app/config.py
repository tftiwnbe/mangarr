import yaml
from pathlib import Path
from typing import Any, Literal
from pydantic import Field
from pydantic_settings import (
    BaseSettings,
    SettingsConfigDict,
    PydanticBaseSettingsSource,
)
from pydantic_settings.sources import (
    YamlConfigSettingsSource,
)


APP_DIR = Path(__file__).resolve().parent
CONFIG_DIR = APP_DIR.parents[1] / "config"


# -----------------------------------------------------
# Shared base for all config models
# -----------------------------------------------------
class MangarrBaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
        env_nested_delimiter="__",
        env_prefix="MANGARR__",
    )


# -----------------------------------------------------
# Submodels
# -----------------------------------------------------
class AppConfig(MangarrBaseSettings):
    project_name: str = "Mangarr"
    version: str = "2.0.0"
    config_dir: Path = CONFIG_DIR
    log_dir: Path = CONFIG_DIR / "log"
    static_root: Path = APP_DIR / "static"

    cors_allow_origins: list[str] = Field(default_factory=lambda: ["*"])
    cors_allow_origin_regex: str | None = None
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]

    @property
    def config_path(self) -> Path:
        return self.config_dir / "config.yaml"

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.config_dir}/mangarr.db"

    model_config = SettingsConfigDict(frozen=True)


class ServerConfig(MangarrBaseSettings):
    host: str = "127.0.0.1"
    port: int = 3737


class LogConfig(MangarrBaseSettings):
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    rotation: str = "10 MB"  # bytes or time to automatically rotate
    retention: str | None = "14 days"  # optional cleanup policy
    access: bool = False  # access logs from middleware
    sql: bool = False  # log SQL queries sent to the database


# -----------------------------------------------------
# Main Settings model
# -----------------------------------------------------
class Settings(MangarrBaseSettings):
    app: AppConfig = AppConfig()
    server: ServerConfig = ServerConfig()
    log: LogConfig = LogConfig()

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        env_prefix="MANGARR__",
        env_nested_delimiter="__",
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        yaml_source = YamlConfigSettingsSource(
            settings_cls,
            yaml_file=CONFIG_DIR / "config.yaml",
            yaml_file_encoding="utf-8",
        )
        return (
            env_settings,
            dotenv_settings,
            yaml_source,
            init_settings,
            file_secret_settings,
        )


def save_settings(settings: Settings) -> None:
    """Persist settings back to YAML config file."""
    path = settings.app.config_path
    data = settings.model_dump(exclude={"app"}, mode="json")

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(data, f)


def update_settings(settings: Settings, updates: dict[str, Any]) -> Settings:
    """Update settings with a dictionary of new values."""
    new_data = settings.model_dump(mode="json")
    for key, value in updates.items():
        if key in new_data and isinstance(value, dict):
            # Merge nested dicts
            new_data[key] = {**new_data[key], **value}
        else:
            new_data[key] = value
    return Settings(**new_data)


settings = Settings()
save_settings(settings)
