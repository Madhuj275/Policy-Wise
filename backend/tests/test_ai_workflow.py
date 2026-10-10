import json
import os
import sys
import tempfile
import unittest
from unittest import mock

TEST_DIRECTORY = tempfile.TemporaryDirectory(prefix="policy-agent-tests-", ignore_cleanup_errors=True)
DB_FILE = os.path.join(TEST_DIRECTORY.name, "workflow.sqlite3")
os.environ["DB_PATH"] = DB_FILE
os.environ["DATABASE_URL"] = ""
os.environ["GEMINI_API_KEY"] = "unit-test-key"
os.environ["AI_LOG_CONTENT"] = "false"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import main as api  # noqa: E402


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class AIWorkflowTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        TEST_DIRECTORY.cleanup()

    def setUp(self):
        api.DB = DB_FILE
        api.KEY = "unit-test-key"
        database = api.conn()
        try:
            for table in ("actions", "mappings", "changes", "snaps", "assessments", "docs", "controls", "meta", "audit"):
                database.execute(f"DELETE FROM {table}")
            database.commit()
        finally:
            database.close()
        api.add_doc(api.Doc(kind="old", name="Old policy", text="1. Access reviews happen annually."))
        api.add_doc(api.Doc(kind="new", name="New policy", text="1. Access reviews happen quarterly."))
        api.add_ctrl(api.Ctrl(ref="AC-1", name="Access review", description="Access review control", evidence="Test evidence"))

    def provider_response(self, rationale="Quarterly review frequency changed"):
        change_id = api.q("SELECT id FROM changes ORDER BY id LIMIT 1")[0]["id"]
        control_id = api.q("SELECT id FROM controls ORDER BY id LIMIT 1")[0]["id"]
        mappings = [
            {"change_id": change_id, "control_id": control_id, "impact": "confirmed", "rationale": rationale},
            {"change_id": 999001, "control_id": control_id, "impact": "possible", "rationale": "unknown change"},
            {"change_id": change_id, "control_id": 999002, "impact": "possible", "rationale": "unknown control"},
            {"change_id": change_id, "control_id": control_id, "impact": "possible", "rationale": "duplicate"},
        ]
        return FakeResponse({"candidates": [{"content": {"parts": [{"text": json.dumps({"mappings": mappings})}]}}]})

    @staticmethod
    def records(captured):
        return [json.loads(record.getMessage()) for record in captured.records]

    def test_success_logs_timing_hashes_and_dropped_hallucinated_ids(self):
        with self.assertLogs(api.workflow_logger, level="INFO") as captured:
            with mock.patch("main.requests.post", side_effect=lambda *args, **kwargs: self.provider_response()):
                result = api.assess()
        records = self.records(captured)
        started = next(record for record in records if record["event"] == "ai.request.started")
        completed = next(record for record in records if record["event"] == "ai.request.completed")
        validation = next(record for record in records if record["event"] == "ai.output.validation")
        self.assertEqual(result["warning"], None)
        self.assertEqual(completed["operation"], "assessment")
        self.assertGreaterEqual(completed["duration_ms"], 0)
        self.assertEqual(len(started["prompt_sha256"]), 64)
        self.assertEqual(len(completed["response_sha256"]), 64)
        self.assertFalse(completed["content_capture_enabled"])
        self.assertNotIn("prompt", completed)
        self.assertNotIn("response", completed)
        self.assertEqual(validation["invalid_change_ids"], ["999001"])
        self.assertEqual(validation["invalid_control_ids"], ["999002"])
        self.assertEqual(validation["duplicate_pairs"], [[1, 1]])
        self.assertEqual(validation["accepted_count"], 1)
        self.assertEqual(len(api.q("SELECT id FROM mappings")), 1)
        self.assertEqual(api.q("SELECT mode FROM assessments")[0]["mode"], "gemini")

    def test_provider_failure_is_sanitized_and_uses_logged_fallback(self):
        secret_error = "provider error contains private response text"
        with self.assertLogs(api.workflow_logger, level="INFO") as captured:
            with mock.patch("main.requests.post", side_effect=api.requests.Timeout(secret_error)):
                result = api.assess()
        records = self.records(captured)
        failed = next(record for record in records if record["event"] == "ai.request.failed")
        fallback = next(record for record in records if record["event"] == "ai.workflow.fallback")
        self.assertEqual(failed["failure_category"], "timeout")
        self.assertGreaterEqual(failed["duration_ms"], 0)
        self.assertEqual(fallback["reason"], "provider_failure")
        self.assertNotIn(secret_error, result["warning"])
        self.assertEqual(api.q("SELECT mode FROM assessments")[0]["mode"], "offline-heuristic")

    def test_raw_prompt_and_response_are_logged_only_with_explicit_opt_in(self):
        with mock.patch.dict(os.environ, {"AI_LOG_CONTENT": "true"}):
            with self.assertLogs(api.workflow_logger, level="INFO") as captured:
                with mock.patch("main.requests.post", side_effect=lambda *args, **kwargs: self.provider_response("safe opt-in response marker")):
                    api.assess()
        records = self.records(captured)
        started = next(record for record in records if record["event"] == "ai.request.started")
        completed = next(record for record in records if record["event"] == "ai.request.completed")
        self.assertIn("Access reviews happen quarterly", started["prompt"])
        self.assertIn("safe opt-in response marker", completed["response"])

    def test_context_audit_does_not_store_answer_and_reanalysis_failure_is_structured(self):
        with mock.patch("main.requests.post", side_effect=lambda *args, **kwargs: self.provider_response()):
            api.assess()
        mapping_id = api.q("SELECT id FROM mappings LIMIT 1")[0]["id"]
        private_answer = "confidential reviewer answer"
        with self.assertLogs(api.workflow_logger, level="INFO") as captured:
            with mock.patch("main.requests.post", side_effect=api.requests.Timeout("raw provider detail")):
                with self.assertRaises(api.HTTPException) as raised:
                    api.answers(mapping_id, api.Ans(answers={"internal question": private_answer}))
        records = self.records(captured)
        failed = next(record for record in records if record["event"] == "ai.request.failed")
        self.assertEqual(failed["operation"], "mapping_reanalysis")
        self.assertEqual(failed["mapping_id"], mapping_id)
        self.assertEqual(raised.exception.status_code, 502)
        self.assertNotIn("raw provider detail", raised.exception.detail)
        event = next(item for item in api.q("SELECT * FROM audit WHERE event='context_provided'") )
        self.assertIn("answer_count 1", event["detail"])
        self.assertNotIn(private_answer, event["detail"])


if __name__ == "__main__":
    unittest.main()
