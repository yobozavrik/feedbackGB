import asyncio
import unittest

from worker import BackendError, packet, process_one


class FakeBackend:
    def __init__(self, fail_ledger=False, prior_ids=None):
        self.patches = []
        self.fail_ledger = fail_ledger
        self.prior_ids = prior_ids or []

    def claim(self, chat_id):
        return "job-1"

    def one(self, table, select, filters):
        return {
            "utility_delivery_jobs": {"id": "job-1", "submission_id": "submission-1", "message_ids": self.prior_ids},
            "utility_submissions": {"id": "submission-1", "store_id": 7, "period_id": "period-1", "category": "water",
                                    "comment": "<увага>", "submitted_by": "user-1", "revision": 2},
            "utility_periods": {"period_start": "2026-10-01", "period_end": "2026-10-31"},
            "users": {"full_name": "Олена"},
            "v_stores": {"name": "Магазин & 7"},
            "utility_uploads": {"storage_path": "utility/7/period-1/water/photo.jpg", "mime": "image/jpeg"},
        }[table]

    def rows(self, table, select, filters, order=""):
        return [{"id": "photo-1", "upload_id": "upload-1", "sort_order": 0}]

    def download(self, path):
        return b"image"

    def patch_job(self, job_id, payload):
        if self.fail_ledger and "state" not in payload:
            raise BackendError(500)
        self.patches.append(payload.copy())


class FakeMessage:
    def __init__(self, message_id):
        self.id = message_id


class FakeClient:
    def __init__(self, fail_on_text=False):
        self.fail_on_text = fail_on_text
        self.text = None
        self.files = None

    async def send_message(self, peer, text, **kwargs):
        self.text = text
        if self.fail_on_text:
            raise TimeoutError("response_lost")
        return FakeMessage(101)

    async def send_file(self, peer, files, **kwargs):
        self.files = files
        return FakeMessage(102)


class PacketTests(unittest.TestCase):
    def test_packet_preserves_identity_and_escapes_comment(self):
        text, files = packet(FakeBackend(), "submission-1")
        self.assertIn("Магазин &amp; 7", text)
        self.assertIn("&lt;увага&gt;", text)
        self.assertIn("Версія: 2", text)
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].name, "utility-photo-1.jpg")


class DeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_success_writes_text_photo_and_final_state(self):
        backend, client = FakeBackend(), FakeClient()
        self.assertTrue(await process_one(client, "peer", backend, -5364085383))
        self.assertEqual(backend.patches[0]["message_ids"], [101])
        self.assertEqual(backend.patches[-1]["state"], "sent")
        self.assertEqual(backend.patches[-1]["message_ids"], [101, 102])

    async def test_lost_send_response_is_uncertain_and_not_retried(self):
        backend = FakeBackend()
        await process_one(FakeClient(fail_on_text=True), "peer", backend, -5364085383)
        self.assertEqual(backend.patches[-1]["state"], "uncertain")

    async def test_ledger_failure_after_text_is_uncertain(self):
        backend = FakeBackend(fail_ledger=True)
        await process_one(FakeClient(), "peer", backend, -5364085383)
        self.assertEqual(backend.patches[-1]["state"], "uncertain")
        self.assertEqual(backend.patches[-1]["message_ids"], [101])

    async def test_preexisting_message_ids_are_not_resent(self):
        backend, client = FakeBackend(prior_ids=[77]), FakeClient()
        await process_one(client, "peer", backend, -5364085383)
        self.assertIsNone(client.text)
        self.assertEqual(backend.patches[-1]["state"], "uncertain")
        self.assertEqual(backend.patches[-1]["message_ids"], [77])


if __name__ == "__main__":
    unittest.main()
