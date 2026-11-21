"""Unit tests for scripts/ops/oncall.py (EN-06, #165). Run: python3 -m unittest scripts/ops/test_oncall.py"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oncall  # noqa: E402

SEV1 = {"id": "api-down", "title": "API down", "sev": 1, "type": "http", "for_min": 4}
SEV2 = {"id": "db-filling", "title": "DB", "sev": 2, "type": "promql", "for_min": 0}
SEV3 = {"id": "chat-backlog-old", "title": "Backlog", "sev": 3, "type": "promql", "for_min": 0}


class FakePager(oncall.Pager):
    def __init__(self, live=True):
        super().__init__(dry_run=False)
        self.app, self.user = ("a", "u") if live else ("", "")
        self.sent = []

    def send(self, **kw):
        if not self.live:
            return None
        self.sent.append(kw)
        return {"status": 1, "receipt": "r1"} if kw["priority"] == 2 else {"status": 1}

    def cancel(self, receipt):
        self.sent.append({"cancel": receipt})


class StepTest(unittest.TestCase):
    def test_waits_for_duration_then_fires_once(self):
        st = {}
        self.assertEqual(oncall.step(SEV1, st, True, "", 0), [])
        self.assertEqual(oncall.step(SEV1, st, True, "", 120), [])
        self.assertEqual(oncall.step(SEV1, st, True, "", 240), ["fire"])
        st["paged"], st["last_page"] = True, 240
        self.assertEqual(oncall.step(SEV1, st, True, "", 540), [])

    def test_flap_resets_pending(self):
        st = {}
        oncall.step(SEV1, st, True, "", 0)
        oncall.step(SEV1, st, False, "", 120)
        self.assertEqual(oncall.step(SEV1, st, True, "", 240), [])

    def test_reminder_and_resolve(self):
        st = {}
        oncall.step(SEV2, st, True, "", 0)
        st["paged"], st["last_page"] = True, 0
        self.assertEqual(oncall.step(SEV2, st, True, "", 239 * 60), [])
        self.assertEqual(oncall.step(SEV2, st, True, "", 240 * 60), ["remind"])
        self.assertEqual(oncall.step(SEV2, st, False, "", 241 * 60), ["resolve"])
        self.assertEqual(set(st), {"resolved"})

    def test_sev3_never_pages(self):
        st = {}
        self.assertEqual(oncall.step(SEV3, st, True, "", 0), [])
        self.assertTrue(st["active"])
        self.assertEqual(oncall.step(SEV3, st, False, "", 60), [])

    def test_unpaged_alert_pages_when_keys_arrive(self):
        st = {}
        inert, live = FakePager(live=False), FakePager()
        for ev in oncall.step(SEV2, st, True, "", 0):
            oncall.page_for(inert, SEV2, st, ev, 0)
        self.assertFalse(st["paged"])
        for ev in oncall.step(SEV2, st, True, "", 300):
            oncall.page_for(live, SEV2, st, ev, 300)
        self.assertTrue(st["paged"])
        self.assertEqual(len(live.sent), 1)


class PageTest(unittest.TestCase):
    def test_sev1_is_emergency_with_runbook_and_resolve_cancels(self):
        p, st = FakePager(), {}
        oncall.step(SEV1, st, True, "HTTP 502", 0)
        for ev in oncall.step(SEV1, st, True, "HTTP 502", 300):
            oncall.page_for(p, SEV1, st, ev, 300)
        msg = p.sent[0]
        self.assertEqual(msg["priority"], 2)
        self.assertTrue(msg["url"].endswith("alerts.md#api-down"))
        self.assertIn("HTTP 502", msg["message"])
        self.assertEqual(st["receipt"], "r1")
        for ev in oncall.step(SEV1, st, False, "", 600):
            oncall.page_for(p, SEV1, st, ev, 600)
        self.assertEqual(p.sent[1]["priority"], -1)
        self.assertEqual(p.sent[2], {"cancel": "r1"})

    def test_sev2_is_normal_priority(self):
        p, st = FakePager(), {}
        for ev in oncall.step(SEV2, st, True, "", 0):
            oncall.page_for(p, SEV2, st, ev, 0)
        self.assertEqual(p.sent[0]["priority"], 0)


class EvaluateTest(unittest.TestCase):
    def test_query_errors_trigger_metrics_unreachable_not_resolve(self):
        rules = {"prometheus": "https://x", "rules": [
            dict(SEV2, query="up"),
            {"id": "metrics-unreachable", "title": "blind", "sev": 2, "type": "meta", "for_min": 0},
        ]}
        state = {"alerts": {"db-filling": {"active": True, "paged": True, "firing_since": 0, "last_page": 0}}}
        p = FakePager()
        rows = oncall.evaluate(rules, state, p, 100, token=None)
        self.assertEqual(rows[0]["status"], "error")
        self.assertTrue(state["alerts"]["db-filling"]["active"])  # not resolved by an error
        self.assertEqual(rows[1]["status"], "FIRING")


class RulesFileTest(unittest.TestCase):
    def test_rules_valid_and_every_rule_has_runbook(self):
        self.assertEqual(oncall.check(oncall.load_rules(), oncall.runbook_anchors()), [])


if __name__ == "__main__":
    unittest.main()
