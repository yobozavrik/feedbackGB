"""One-process Telegram account outbox for utility photos. No Bot API calls."""
import asyncio
import html
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from telethon import TelegramClient, errors

from config import Config

CATEGORY = {"electricity": "Електроенергія", "water": "Вода", "heating": "Опалення", "other": "Інші послуги"}
BUCKET = "utility-reading-photos"


def log(event: str, **fields: object) -> None:
    allowed = {"job_id", "submission_id", "state", "error_code", "message_count", "status"}
    safe = {k: v for k, v in fields.items() if k in allowed and isinstance(v, (str, int))}
    print(json.dumps({"event": event, **safe}), flush=True)


class BackendError(Exception):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f"backend_http_{status}")


class PacketError(Exception):
    pass


class Backend:
    def __init__(self, config: Config):
        self.url = config.supabase_url
        self.key = config.supabase_key

    def request(self, method: str, path: str, payload: object = None, *, profile: bool = True, binary: bool = False):
        headers = {"apikey": self.key, "Authorization": "Bearer " + self.key}
        if profile:
            headers["Accept-Profile"] = "feedbackgb"
            if method in ("POST", "PATCH"):
                headers["Content-Profile"] = "feedbackgb"
        if method == "PATCH":
            headers["Prefer"] = "return=representation"
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = Request(self.url + path, data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=45) as response:
                raw = response.read()
                return raw if binary else json.loads(raw) if raw else None
        except HTTPError as exc:
            raise BackendError(exc.code) from None
        except (URLError, TimeoutError):
            raise BackendError(0) from None

    def rows(self, table: str, select: str, filters: dict[str, str], order: str = "") -> list[dict]:
        params = {"select": select, **filters}
        if order:
            params["order"] = order
        result = self.request("GET", "/rest/v1/" + table + "?" + urlencode(params))
        if not isinstance(result, list):
            raise PacketError("unexpected_table_response")
        return result

    def one(self, table: str, select: str, filters: dict[str, str]) -> dict:
        result = self.rows(table, select, filters)
        if len(result) != 1:
            raise PacketError("missing_or_duplicate_" + table)
        return result[0]

    def claim(self, chat_id: int) -> str | None:
        result = self.request("POST", "/rest/v1/rpc/claim_utility_delivery_job", {"p_chat_id": str(chat_id)})
        if result is not None and not isinstance(result, str):
            raise PacketError("invalid_claim_result")
        return result

    def patch_job(self, job_id: str, payload: dict) -> None:
        result = self.request("PATCH", "/rest/v1/utility_delivery_jobs?" + urlencode({"id": "eq." + job_id}), payload)
        if not isinstance(result, list) or len(result) != 1:
            raise BackendError(0)

    def download(self, storage_path: str) -> bytes:
        if not storage_path.startswith("utility/") or ".." in storage_path.split("/"):
            raise PacketError("invalid_storage_path")
        result = self.request("GET", "/storage/v1/object/authenticated/" + BUCKET + "/" + quote(storage_path, safe="/"), profile=False, binary=True)
        if not isinstance(result, bytes) or not result or len(result) > 2_097_152:
            raise PacketError("invalid_photo_bytes")
        return result


def packet(backend: Backend, submission_id: str) -> tuple[str, list[io.BytesIO]]:
    submission = backend.one("utility_submissions", "id,store_id,period_id,category,comment,submitted_by,revision", {"id": "eq." + submission_id})
    period = backend.one("utility_periods", "period_start,period_end", {"id": "eq." + submission["period_id"]})
    user = backend.one("users", "full_name", {"id": "eq." + submission["submitted_by"]})
    store = backend.one("v_stores", "name", {"id": "eq." + str(submission["store_id"])})
    photos = backend.rows("utility_photos", "id,upload_id,sort_order", {"submission_id": "eq." + submission_id}, "sort_order.asc")
    if not 1 <= len(photos) <= 3 or submission["category"] not in CATEGORY:
        raise PacketError("invalid_photo_count_or_category")
    files = []
    for photo in photos:
        upload = backend.one("utility_uploads", "storage_path,mime", {"id": "eq." + photo["upload_id"]})
        if upload["mime"] not in ("image/jpeg", "image/png", "image/webp"):
            raise PacketError("invalid_photo_mime")
        blob = io.BytesIO(backend.download(upload["storage_path"]))
        blob.name = "utility-" + photo["id"] + (".png" if upload["mime"] == "image/png" else ".webp" if upload["mime"] == "image/webp" else ".jpg")
        files.append(blob)
    lines = [
        "<b>" + ("ВИПРАВЛЕННЯ ФОТО ПОСЛУГИ" if submission["revision"] > 1 else "ФОТО КОМУНАЛЬНОЇ ПОСЛУГИ") + "</b>",
        "Магазин: <b>" + html.escape(str(store["name"])) + "</b>",
        "Послуга: <b>" + CATEGORY[submission["category"]] + "</b>",
        "Період: " + html.escape(str(period["period_start"])) + " — " + html.escape(str(period["period_end"])),
        "Автор: " + html.escape(str(user["full_name"] or "невідомо")),
        "Версія: " + str(submission["revision"]) + " · № " + html.escape(submission_id),
        "Фото: " + str(len(files)),
        "Стан: подано; перевірка в адмінці окрема",
    ]
    if submission.get("comment"):
        lines.append("Коментар: " + html.escape(str(submission["comment"])))
    message = "\n".join(lines)
    if len(message) > 4000:
        raise PacketError("text_too_long")
    return message, files


async def verify_peer(client: TelegramClient, chat_id: int):
    me = await client.get_me()
    if not me or me.bot:
        raise RuntimeError("expected_a_user_account")
    async for dialog in client.iter_dialogs():
        if dialog.id == chat_id and dialog.is_group:
            return dialog.input_entity
    raise RuntimeError("target_group_not_visible_to_account")


async def process_one(client: TelegramClient, peer, backend: Backend, chat_id: int) -> bool:
    job_id = await asyncio.to_thread(backend.claim, chat_id)
    if job_id is None:
        return False
    message_ids: list[int] = []
    send_attempted = False
    outcome = "uncertain"
    error_code = None
    retry_delay = 300
    submission_id = ""
    try:
        job = await asyncio.to_thread(backend.one, "utility_delivery_jobs", "id,submission_id,message_ids", {"id": "eq." + job_id})
        submission_id = job["submission_id"]
        if isinstance(job["message_ids"], list):
            message_ids = [item for item in job["message_ids"] if isinstance(item, int)]
        if job["message_ids"]:
            raise PacketError("claimed_job_has_messages")
        message, files = await asyncio.to_thread(packet, backend, submission_id)
        send_attempted = True
        sent_text = await client.send_message(peer, message, parse_mode="html", link_preview=False)
        message_ids.append(sent_text.id)
        await asyncio.to_thread(backend.patch_job, job_id, {"message_ids": message_ids.copy()})
        send_attempted = True
        sent_photos = await client.send_file(peer, files if len(files) > 1 else files[0], reply_to=sent_text.id)
        replies = sent_photos if isinstance(sent_photos, list) else [sent_photos]
        if len(replies) != len(files) or any(not isinstance(reply.id, int) for reply in replies):
            raise PacketError("invalid_send_file_result")
        message_ids.extend(reply.id for reply in replies)
        await asyncio.to_thread(backend.patch_job, job_id, {"message_ids": message_ids.copy()})
        outcome = "sent"
    except Exception as exc:
        if isinstance(exc, errors.FloodWaitError):
            retry_delay = max(60, int(exc.seconds))
        error_code = (
            "flood_wait" if isinstance(exc, errors.FloodWaitError)
            else "backend_error" if isinstance(exc, BackendError)
            else str(exc) if isinstance(exc, PacketError)
            else "telegram_or_unknown_error"
        )
        # A timed-out send may have succeeded. Never auto-retry after send began.
        outcome = "uncertain" if send_attempted or message_ids else "permanent_failed" if isinstance(exc, PacketError) else "retryable_failed"
        log("utility.delivery.failed", job_id=job_id, submission_id=submission_id, state=outcome, error_code=error_code, message_count=len(message_ids))
    try:
        next_attempt = datetime.now(timezone.utc) + timedelta(seconds=retry_delay)
        await asyncio.to_thread(backend.patch_job, job_id, {
            "state": outcome,
            "message_ids": message_ids.copy(),
            "last_error_code": error_code,
            "locked_until": None,
            "next_attempt_at": next_attempt.isoformat(),
            "sent_at": datetime.now(timezone.utc).isoformat() if outcome == "sent" else None,
        })
    except BackendError:
        log("utility.delivery.state_write_failed", job_id=job_id, submission_id=submission_id, state="sending", error_code="backend_error")
        return True
    log("utility.delivery.finished", job_id=job_id, submission_id=submission_id, state=outcome, message_count=len(message_ids))
    return True


async def main() -> None:
    import fcntl  # Linux host lock; importing the module does not require Linux.

    config = Config.from_env()
    if not config.enabled and not ({"--check", "--send-test"} & set(sys.argv)):
        log("utility.delivery.disabled")
        while True:
            await asyncio.sleep(60)
    path = Path(config.session_path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = open(str(path) + ".lock", "a+b")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError("worker_already_running") from None
    client = TelegramClient(str(path), config.api_id, config.api_hash, receive_updates=False)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("session_not_authorized_run_bootstrap")
        peer = await verify_peer(client, config.chat_id)
        log("utility.delivery.peer_verified")
        if "--check" in sys.argv:
            return
        if "--send-test" in sys.argv:
            await client.send_message(peer,
                "Тест доставки показань. Автоматична відправка фото ще вимкнена.")
            log("utility.delivery.test_sent", message_count=1)
            return
        backend = Backend(config)
        while True:
            try:
                processed = await process_one(client, peer, backend, config.chat_id)
            except (BackendError, PacketError):
                log("utility.delivery.claim_failed", error_code="backend_or_claim_error")
                processed = False
            await asyncio.sleep(2 if processed else 30)
    finally:
        await client.disconnect()
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


if __name__ == "__main__":
    asyncio.run(main())
