"""Application configuration, loaded from environment / .env file.

Every security-relevant knob (CORS, allowed hosts, rate limits, body size,
admin secret, PayPal config) is configurable so the same code runs safely in
development and production by changing the environment only.
"""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Annotated, List, Union

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Directory that contains this backend package (…/AdelineTarot/backend).
BACKEND_DIR = Path(__file__).resolve().parent.parent


def _split_csv(value: Union[str, List[str]]) -> List[str]:
    """Parse a comma-separated string into a clean list of items."""
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    """Strongly-typed application settings."""

    model_config = SettingsConfigDict(
        env_prefix="ADELINE_",
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "AdelineTarot API"
    debug: bool = False

    database_url: str = "sqlite:///./adelinetarot.db"

    # NoDecode lets these be provided as a comma-separated string in the
    # environment; the validator below splits them (otherwise pydantic-settings
    # would try to JSON-decode the value first and fail on plain CSV).
    cors_origins: Annotated[List[str], NoDecode] = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
    allowed_hosts: Annotated[List[str], NoDecode] = ["localhost", "127.0.0.1"]

    serve_frontend: bool = True
    frontend_dir: str = ".."

    # Abuse protection
    max_request_bytes: int = 256 * 1024
    write_ratelimit_max: int = 12
    write_ratelimit_window: int = 60
    read_ratelimit_max: int = 90
    read_ratelimit_window: int = 60
    trust_proxy: bool = False

    # Admin (AdelineTarot) access. Override ADELINE_ADMIN_TOKEN in production.
    # When left empty a random token is generated at startup and logged once.
    admin_token: str = ""

    # Video calls — a unique Jitsi Meet room is built per booking. No API key
    # needed; the same URL is shared by the client and the admin.
    video_base_url: str = "https://meet.jit.si"
    video_room_prefix: str = "AdelineTarot"

    # Payment — PayPal. Drop your live/sandbox client id here to enable the
    # in-page PayPal buttons. The PayPal.Me handle powers the manual fallback.
    paypal_client_id: str = ""
    paypal_me_handle: str = "adelinetarot"
    # Authoritative plan catalogue (currency -> amount). Never trust the client.
    price_mxn: float = 100.0
    price_pen: float = 20.0
    # PayPal cannot settle in PEN; the sol plan is charged as this USD value.
    price_pen_as_usd: float = 6.0

    @field_validator("cors_origins", "allowed_hosts", mode="before")
    @classmethod
    def _parse_csv(cls, value: object) -> List[str]:
        if isinstance(value, str):
            return _split_csv(value)
        return value  # type: ignore[return-value]

    @property
    def frontend_path(self) -> Path:
        """Resolved absolute path to the folder holding index.html."""
        p = Path(self.frontend_dir)
        if not p.is_absolute():
            p = (BACKEND_DIR / p).resolve()
        return p

    @property
    def resolved_admin_token(self) -> str:
        """Return the configured admin token, generating one if unset."""
        if not self.admin_token:
            object.__setattr__(self, "admin_token", secrets.token_urlsafe(24))
        return self.admin_token


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


settings = get_settings()
