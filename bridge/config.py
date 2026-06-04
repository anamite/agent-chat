"""
config.py — Bridge settings.

Loaded from environment (prefix ``BRIDGE_``) and an optional ``.env`` file.
The Bridge binds 127.0.0.1 only; cloudflared is the sole path from outside.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Bridge data lives under ~/.hermes/bridge by default (db, uploads, allowlist).
DEFAULT_DATA_DIR = Path.home() / ".hermes" / "bridge"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="BRIDGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Network -----------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8787

    # --- Hermes API --------------------------------------------------------
    hermes_url: str = "http://127.0.0.1:4700"
    hermes_chat_path: str = "/v1/chat/completions"
    hermes_model: str = "hermes"
    hermes_timeout_s: float = 120.0
    hermes_key: str = ""  # Bearer token for API_SERVER_KEY
    # How many prior messages to replay as chat history per turn.
    hermes_history_limit: int = 20
    # Inject a system turn that teaches the agent the interactive-UI protocol
    # (fenced ```hermes-ui blocks + the confirmation-card convention). This is
    # what makes buttons / forms / approval cards appear instead of plain text,
    # without depending on the Hermes server having the app_ui toolset enabled.
    # Set BRIDGE_UI_SYSTEM_PROMPT=0 to disable (e.g. if you wire the ui_* tools
    # natively via platform_toolsets.api_server instead).
    ui_system_prompt: bool = True

    # --- Voice (STT via Hermes' faster-whisper; TTS via edge-tts) ----------
    # The Hermes agent ships faster-whisper in its own venv; we shell out to it
    # rather than installing a second copy in the Bridge env.
    hermes_agent_dir: Path = Path.home() / ".hermes" / "hermes-agent"
    stt_model: str | None = None  # None -> Hermes config default
    stt_timeout_s: float = 120.0
    tts_voice: str = "en-US-AriaNeural"

    # --- Storage -----------------------------------------------------------
    data_dir: Path = DEFAULT_DATA_DIR

    # --- Secrets -----------------------------------------------------------
    # Shared secret for the localhost-only POST /internal/ui endpoint, which
    # the Hermes plugin uses to push frames. Generated per-process if unset;
    # set BRIDGE_INTERNAL_TOKEN in the environment so the plugin matches.
    internal_token: str = Field(default_factory=lambda: secrets.token_hex(32))

    # Public tunnel URL baked into pairing QR codes (e.g. wss://hermes.example.com).
    public_url: str = "wss://CHANGE-ME.example.com"

    # --- Limits (mirror Hermes' own API hardening) -------------------------
    max_frame_bytes: int = 256 * 1024
    max_blocks_per_message: int = 50
    max_upload_bytes: int = 50 * 1024 * 1024  # 50 MiB
    allowed_upload_mimes: tuple[str, ...] = (
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "application/pdf",
        "audio/mp4",
        "audio/m4a",
        "audio/mpeg",
        "audio/ogg",
        "audio/webm",
        "text/plain",
    )
    # Per-connection inbound WS frame cap (token bucket; burst = one minute).
    ws_rate_limit_per_min: int = 600
    # New WS connection attempts allowed per remote host per minute.
    ws_connect_rate_limit_per_min: int = 60
    # POST /internal/ui calls allowed per minute (loopback plugin pushes).
    internal_rate_limit_per_min: int = 600

    # --- Heartbeat ---------------------------------------------------------
    ping_interval_s: float = 20.0
    pong_timeout_s: float = 10.0

    @property
    def db_path(self) -> Path:
        return self.data_dir / "bridge.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def allowlist_path(self) -> Path:
        return self.data_dir / "allowlist.txt"

    @property
    def hermes_chat_url(self) -> str:
        return self.hermes_url.rstrip("/") + self.hermes_chat_path

    @property
    def hermes_agent_python(self) -> Path:
        return self.hermes_agent_dir / "venv" / "bin" / "python"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
