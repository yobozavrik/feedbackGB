"""Run once interactively on the VPS. Never print or copy the session file."""
import asyncio
import getpass
import os
from pathlib import Path

from telethon import TelegramClient

from config import Config


async def main() -> None:
    config = Config.from_env()
    path = Path(config.session_path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    client = TelegramClient(str(path), config.api_id, config.api_hash)
    try:
        await client.start(
            phone=lambda: input("Work account phone: "),
            code_callback=lambda: getpass.getpass("Telegram login code: "),
            password=lambda: getpass.getpass("Telegram 2FA password (if requested): "),
        )
        me = await client.get_me()
        if not me or me.bot:
            raise RuntimeError("expected_a_user_account")
        found = False
        async for dialog in client.iter_dialogs():
            if dialog.id == config.chat_id and dialog.is_group:
                found = True
                break
        if not found:
            raise RuntimeError("target_group_not_visible_to_account")
    finally:
        await client.disconnect()
    session_file = Path(str(path) + ".session")
    if session_file.exists():
        os.chmod(session_file, 0o600)
    print("account_login_and_target_group_verified; session saved in protected volume")


if __name__ == "__main__":
    asyncio.run(main())
