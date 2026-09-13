import copy
import sys
import types
import unittest
from unittest.mock import patch
from collector import Collector, Db2Reader, History, classify, delta, unavailable


class Reader:
    def __init__(self):
        self.fail = False
        self.total = 100
        self.connection_total = 100
        self.start = "activation-1"

    def close(self):
        pass

    def query(self, name):
        if self.fail:
            raise RuntimeError("SQLSTATE=08001 secret not to publish")
        if name == "database":
            return [
                dict(
                    MEMBER=0,
                    DB_CONN_TIME=self.start,
                    TOTAL_APP_SECTION_EXECUTIONS=self.total,
                    TOTAL_ACT_TIME=self.total * 10,
                    ACT_COMPLETED_TOTAL=self.total,
                    POOL_DATA_L_READS=self.total * 10,
                    POOL_INDEX_L_READS=self.total * 10,
                    POOL_DATA_P_READS=self.total,
                    POOL_INDEX_P_READS=self.total,
                    DEADLOCKS=0,
                    LOCK_TIMEOUTS=0,
                )
            ]
        if name == "connections":
            return [
                dict(
                    MEMBER=0,
                    APPLICATION_HANDLE=1,
                    APPLICATION_ID="app-1",
                    APPLICATION_NAME="CREANETAPI.exe",
                    CLIENT_APPLNAME="",
                    CLIENT_WRKSTNNAME="ATLAS",
                    CLIENT_HOSTNAME="ATLAS",
                    SESSION_AUTH_ID="USERPROD",
                    TOTAL_APP_SECTION_EXECUTIONS=self.connection_total,
                )
            ]
        if name == "activities":
            return [dict(APPLICATION_HANDLE=1, ACTIVITY_STATE="EXECUTING")]
        if name == "system":
            return [dict(CPU_USAGE_TOTAL=38, MEMORY_TOTAL=100, MEMORY_FREE=30)]
        if name == "queries":
            return []


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.r = Reader()
        self.h = History(":memory:")
        self.c = Collector(self.r, self.h)

    def sample(self, seconds):
        with patch("collector.time.monotonic", return_value=seconds), patch(
            "collector.time.time", return_value=1800000000 + seconds
        ):
            return self.c.collect()

    def test_baseline_is_unknown_then_delta_is_rate(self):
        first = self.sample(0)
        self.assertIsNone(first["metrics"]["sql"]["value"])
        self.r.total += 20
        self.r.connection_total += 20
        second = self.sample(2)
        self.assertEqual(second["metrics"]["sql"]["value"], 10)
        self.assertEqual(second["metrics"]["response"]["value"], 10)
        self.assertEqual(second["metrics"]["cache"]["value"], 90)
        self.assertAlmostEqual(
            sum(a["sqlExecutionsPerSecond"]["value"] for a in second["applications"]),
            10,
        )
        self.assertAlmostEqual(
            sum(a["sharePercent"] for a in second["applications"]), 100
        )

    def test_zero_activity_not_unknown_and_no_response(self):
        self.sample(0)
        sample = self.sample(2)
        self.assertEqual(sample["metrics"]["sql"]["value"], 0)
        self.assertEqual(sample["metrics"]["response"]["quality"], "not-applicable")

    def test_failure_nulls_metrics_and_recovery_requires_baseline(self):
        self.sample(0)
        self.r.total += 10
        self.r.connection_total += 10
        self.sample(2)
        self.r.fail = True
        bad = self.sample(4)
        self.assertTrue(all(m["value"] is None for m in bad["metrics"].values()))
        self.assertEqual(bad["database"], "unknown")
        self.assertNotIn("secret", str(bad))
        self.r.fail = False
        self.r.total += 500
        self.r.connection_total += 500
        self.assertIsNone(self.sample(6)["metrics"]["sql"]["value"])
        self.r.total += 4
        self.r.connection_total += 4
        self.assertEqual(self.sample(8)["metrics"]["sql"]["value"], 2)

    def test_counter_reset_and_activation_change_never_spike(self):
        self.sample(0)
        self.r.total = 5
        self.r.connection_total = 5
        self.assertIsNone(self.sample(2)["metrics"]["sql"]["value"])
        self.r.start = "activation-2"
        self.r.total = 1000
        self.r.connection_total = 1000
        self.assertIsNone(self.sample(4)["metrics"]["sql"]["value"])

    def test_unknown_iops_stays_unknown(self):
        self.assertIsNone(self.sample(0)["metrics"]["iops"]["value"])

    def test_stale_sample_has_no_green_state(self):
        s = self.sample(0)
        bad = unavailable(s, 1800000040000)
        self.assertEqual(bad["lastGoodAt"], s["lastGoodAt"])
        self.assertEqual(bad["health"], "unknown")
        self.assertTrue(all(m["value"] is None for m in bad["metrics"].values()))

    def test_history_persists_and_marks_gaps(self):
        self.sample(0)
        s = self.sample(180)
        self.assertEqual(len(s["history"]), 3)
        self.assertIsNone(s["history"][1]["sql"])

    def test_availability_is_successful_collections_only(self):
        self.sample(0)
        self.r.fail = True
        self.sample(2)
        self.r.fail = False
        s = self.sample(4)
        self.assertAlmostEqual(s["metrics"]["availability"]["value"], 200 / 3)

    def test_source_metadata_is_preserved_on_success_and_failure(self):
        source = dict(
            sourceId="cirion",
            sourceLabel="Produção — AIX — Cirion",
            host="192.0.2.212",
            database="PRODUCAO",
            platform="AIX",
            location="Cirion",
        )
        collector = Collector(self.r, History(":memory:"), source)
        with patch("collector.time.monotonic", return_value=0), patch(
            "collector.time.time", return_value=1800000000
        ):
            sample = collector.collect()
        self.assertEqual(sample["metadata"]["sourceId"], "cirion")
        self.assertEqual(sample["metadata"]["host"], "192.0.2.212")
        self.r.fail = True
        with patch("collector.time.monotonic", return_value=2), patch(
            "collector.time.time", return_value=1800000002
        ):
            failed = collector.collect()
        self.assertEqual(failed["metadata"]["sourceId"], "cirion")
        self.assertEqual(failed["metadata"]["platform"], "AIX")

    def test_business_origins_are_classified_from_process_and_host(self):
        cases = [
            (
                dict(APPLICATION_NAME="w3wp.exe", CLIENT_HOSTNAME="ONIRO-12-DC"),
                "creaone_oniros",
            ),
            (
                dict(APPLICATION_NAME="w3wp.exe", CLIENT_HOSTNAME="EGEO-13-DC"),
                "creaone_egeos",
            ),
            (dict(APPLICATION_NAME="CREANETAPI.exe"), "creanet"),
            (
                dict(
                    APPLICATION_NAME="dotnet",
                    CLIENT_WRKSTNNAME="certidoes-deployment",
                ),
                "certidoes",
            ),
            (dict(APPLICATION_NAME="Framework.Scheduler."), "retorno"),
            (dict(APPLICATION_NAME="asncap"), "services"),
            (dict(APPLICATION_NAME="w3wp.exe"), "others"),
        ]
        for row, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(classify(row), expected)

    def test_monitor_dash_is_classified_as_service_with_temporary_auth_id(self):
        row = dict(
            APPLICATION_NAME="MonitorDash",
            CLIENT_APPLNAME="MonitorDash",
            CLIENT_WRKSTNNAME="dashboard",
            SESSION_AUTH_ID="TEMPORARY.LDAP.USER",
        )
        self.assertEqual(classify(row), "services")

    def test_short_counter_pause_uses_stable_window_instead_of_zero(self):
        self.sample(0)
        self.r.total += 20
        self.r.connection_total += 20
        self.assertEqual(self.sample(2)["metrics"]["sql"]["value"], 10)
        paused = self.sample(4)
        self.assertEqual(paused["metrics"]["sql"]["value"], 5)
        self.assertEqual(paused["metadata"]["rateWindowMs"], 4000)

    def test_small_counter_rollup_skew_is_normalized(self):
        self.sample(0)
        self.r.total += 100
        self.r.connection_total += 103
        sample = self.sample(2)
        self.assertTrue(sample["metadata"]["attributionAvailable"])
        self.assertAlmostEqual(
            sum(
                app["sqlExecutionsPerSecond"]["value"] for app in sample["applications"]
            ),
            sample["metrics"]["sql"]["value"],
        )
        self.assertAlmostEqual(
            sum(app["sharePercent"] for app in sample["applications"]), 100
        )

    def test_large_counter_disagreement_remains_unavailable(self):
        self.sample(0)
        self.r.total += 10
        self.r.connection_total += 30
        sample = self.sample(2)
        self.assertFalse(sample["metadata"]["attributionAvailable"])
        self.assertTrue(
            all(
                app["sqlExecutionsPerSecond"]["value"] is None
                for app in sample["applications"]
            )
        )


class Db2ReaderTests(unittest.TestCase):
    def test_application_name_is_sent_during_connection(self):
        calls = {}
        fake = types.SimpleNamespace(
            SQL_ATTR_INFO_PROGRAMNAME=2516,
            SQL_ATTR_INFO_APPLNAME=1283,
            SQL_ATTR_QUERY_TIMEOUT=0,
            connect=lambda *args: calls.setdefault("connect", args) or object(),
            prepare=lambda connection, sql, options: object(),
            execute=lambda statement: None,
            fetch_assoc=lambda statement: False,
            free_stmt=lambda statement: None,
        )
        config = dict(
            database="PRODUCAO",
            host="192.0.2.132",
            port=60000,
            username="DASHDBMON",
            password="not-a-real-secret",
        )
        with patch.dict(sys.modules, {"ibm_db": fake}):
            Db2Reader(config).query("database")
        self.assertEqual(
            calls["connect"][3],
            {2516: "MonitorDash", 1283: "MonitorDash"},
        )


if __name__ == "__main__":
    unittest.main()
