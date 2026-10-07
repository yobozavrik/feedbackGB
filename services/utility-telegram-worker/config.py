import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    api_id: int
    api_hash: str
    chat_id: int
    supabase_url: str
    supabase_key: str
    session_path: str
    enabled: bool

    @classmethod
    def from_env(cls) -> "Config":
        def required(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise ValueError(f"missing_{name.lower()}")
            return value

        return cls(
            api_id=int(required("TELEGRAM_API_ID")),
            api_hash=required("TELEGRAM_API_HASH"),
            chat_id=int(required("UTILITY_TELEGRAM_CHAT_ID")),
            supabase_url=required("SUPABASE_URL").rstrip("/"),
            supabase_key=required("SUPABASE_SERVICE_ROLE_KEY"),
            session_path=os.environ.get("TELEGRAM_SESSION_PATH", "/data/utility-account"),
            enabled=os.environ.get("UTILITY_TELEGRAM_ENABLED", "false").lower() == "true",
        )
