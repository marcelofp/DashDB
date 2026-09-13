"""Fixed, read-only Db2 monitor queries. No caller-supplied SQL or DB credentials in output."""

from __future__ import annotations
import copy
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import time

GROUPS = [
    ("creaone_oniros", "CREAONE · ONIROS"),
    ("creaone_egeos", "CREAONE · EGEOS"),
    ("creanet", "CREANET API"),
    ("certidoes", "CERTIDÕES"),
    ("retorno", "RETORNO BANCÁRIO"),
    ("services", "SERVIÇOS / ADM"),
    ("others", "OUTROS"),
]
IOPS_COUNTERS = [
    "POOL_DATA_P_READS",
    "POOL_INDEX_P_READS",
    "POOL_TEMP_DATA_P_READS",
    "POOL_TEMP_INDEX_P_READS",
    "POOL_XDA_P_READS",
    "POOL_TEMP_XDA_P_READS",
    "POOL_DATA_WRITES",
    "POOL_INDEX_WRITES",
    "POOL_XDA_WRITES",
    "DIRECT_READ_REQS",
    "DIRECT_WRITE_REQS",
]
RATE_WINDOW_SECONDS = 8
ATTRIBUTION_TOLERANCE = 0.05
UNITS = dict(
    cpu="%",
    memory="%",
    connections="count",
    executingSessions="count",
    users="count",
    availability="%",
    response="ms",
    iops="IOPS",
    cache="%",
    sql="SQL/s",
)
SQL = {
    "database": """SELECT MEMBER,DB_CONN_TIME,TOTAL_APP_SECTION_EXECUTIONS,TOTAL_ACT_TIME,
        ACT_COMPLETED_TOTAL,POOL_DATA_L_READS,POOL_INDEX_L_READS,POOL_DATA_P_READS,
        POOL_INDEX_P_READS,POOL_TEMP_DATA_P_READS,POOL_TEMP_INDEX_P_READS,
        POOL_XDA_P_READS,POOL_TEMP_XDA_P_READS,POOL_DATA_WRITES,POOL_INDEX_WRITES,
        POOL_XDA_WRITES,DIRECT_READ_REQS,DIRECT_WRITE_REQS,DEADLOCKS,LOCK_TIMEOUTS
        FROM TABLE(SYSPROC.MON_GET_DATABASE(-1)) AS T""",
    "connections": """SELECT MEMBER,APPLICATION_HANDLE,APPLICATION_ID,APPLICATION_NAME,
        CLIENT_APPLNAME,CLIENT_WRKSTNNAME,CLIENT_HOSTNAME,SESSION_AUTH_ID,
        TOTAL_APP_SECTION_EXECUTIONS
        FROM TABLE(SYSPROC.MON_GET_CONNECTION(NULL,-1)) AS T""",
    "activities": """SELECT APPLICATION_HANDLE,ACTIVITY_STATE
        FROM TABLE(SYSPROC.MON_GET_ACTIVITY(NULL,-1)) AS T""",
    "system": """SELECT CPU_USAGE_TOTAL,MEMORY_TOTAL,MEMORY_FREE
        FROM TABLE(SYSPROC.ENV_GET_SYSTEM_RESOURCES()) AS T""",
    "queries": """SELECT HEX(EXECUTABLE_ID) AS SQL_ID,NUM_EXECUTIONS,NUM_EXEC_WITH_METRICS,TOTAL_ACT_TIME
        FROM TABLE(SYSPROC.MON_GET_PKG_CACHE_STMT(NULL,NULL,NULL,-1)) AS T
        WHERE NUM_EXEC_WITH_METRICS>0 ORDER BY TOTAL_ACT_TIME DESC FETCH FIRST 100 ROWS ONLY""",
}

DEFAULT_SOURCE = dict(
    sourceId="huawei",
    sourceLabel="Produção — Huawei",
    host="",
    database="PRODUCAO",
    platform="Linux",
    location="Huawei",
)


def metric(name, value, at, quality=None):
    if value is not None and not math.isfinite(float(value)):
        value = None
    return dict(
        id=name,
        value=value,
        unit=UNITS.get(name, "SQL/s"),
        collectedAt=at,
        source="db2",
        quality=quality or ("good" if value is not None else "unavailable"),
    )


def empty_sample(at=None, source_info=None):
    at = at or int(time.time() * 1000)
    source_info = source_info or DEFAULT_SOURCE
    return dict(
        id=at,
        collectedAt=at,
        lastGoodAt=0,
        source="db2",
        environment="production",
        scenario="unavailable",
        collector="unavailable",
        database="unknown",
        health="unknown",
        metrics={k: metric(k, None, at) for k in UNITS},
        applications=[
            dict(
                id=k,
                name=n,
                sqlExecutionsPerSecond=metric(k, None, at),
                sharePercent=None,
            )
            for k, n in GROUPS
        ],
        history=[],
        alerts=[],
        queries=[],
        sessionGroups=[],
        metadata=dict(
            sampleIntervalMs=2000,
            staleAfterMs=10000,
            **source_info,
        ),
    )


def unavailable(previous, at=None, source_info=None):
    sample = empty_sample(at, source_info)
    if previous:
        sample["lastGoodAt"] = previous["lastGoodAt"]
        sample["history"] = previous["history"]
        sample["metadata"] = previous["metadata"].copy()
    sample["alerts"] = [
        dict(
            id="collector-unavailable",
            time=sample["collectedAt"],
            severity="warning",
            message="Coleta sem confirmação. Verifique a conexão e o serviço.",
        )
    ]
    return sample


def delta(now, before, field):
    a, b = now.get(field), before.get(field)
    if a is None or b is None or a < 0 or b < 0 or a < b:
        return None
    return float(a - b)


def classify(row):
    app = str(row.get("APPLICATION_NAME") or "").strip().lower()
    client = str(row.get("CLIENT_APPLNAME") or "").strip().lower()
    workstation = str(row.get("CLIENT_WRKSTNNAME") or "").strip().lower()
    hostname = str(row.get("CLIENT_HOSTNAME") or "").strip().lower()
    origin = f"{workstation} {hostname}"
    identity = f"{app} {client} {origin}"
    if "oniro" in origin:
        return "creaone_oniros"
    if "egeo" in origin:
        return "creaone_egeos"
    if "framework.scheduler" in app or "retorno" in identity:
        return "retorno"
    if "creanetapi" in app or "creanetapi" in client:
        return "creanet"
    if "certidoes" in identity or app == "dotnet":
        return "certidoes"
    if (
        app == "monitordash"
        or client in {"dashdb", "monitordash"}
        or app == "asncap"
        or app == "db2bp"
        or app.startswith("codex_readonly")
        or app in {"toad", "toad.exe", "dbvis", "dbeaver"}
        or app == "python"
    ):
        return "services"
    return "others"


class Db2Reader:
    def __init__(self, config):
        self.config = config
        self.connection = None

    def close(self):
        if self.connection is not None:
            import ibm_db

            try:
                ibm_db.close(self.connection)
            except Exception:
                pass
        self.connection = None

    def query(self, name):
        import ibm_db

        if self.connection is None:
            c = self.config

            def odbc(value):
                value = str(value)
                if (
                    not value
                    or value != value.strip()
                    or any(char in value for char in ";{}\x00\r\n")
                ):
                    raise ValueError("unsupported_dsn_value")
                return value

            dsn = (
                f"DATABASE={odbc(c['database'])};HOSTNAME={odbc(c['host'])};PORT={int(c['port'])};"
                f"UID={odbc(c['username'])};PWD={odbc(c['password'])};"
                "PROTOCOL=TCPIP;CONNECTTIMEOUT=5;ReceiveTimeout=10;"
            )
            # Set both server-visible names before the connection handshake. ProgramName
            # populates APPLICATION_NAME; ApplName populates CLIENT_APPLNAME.
            connection_options = {
                ibm_db.SQL_ATTR_INFO_PROGRAMNAME: "MonitorDash",
                ibm_db.SQL_ATTR_INFO_APPLNAME: "MonitorDash",
            }
            # SQLDriverConnect uses credentials embedded in the DSN; separate arguments are for aliases.
            self.connection = ibm_db.connect(dsn, "", "", connection_options)
        statement = ibm_db.prepare(
            self.connection, SQL[name], {ibm_db.SQL_ATTR_QUERY_TIMEOUT: 3}
        )
        try:
            ibm_db.execute(statement)
            rows = []
            while True:
                row = ibm_db.fetch_assoc(statement)
                if row is False:
                    break
                rows.append(
                    {k: v.strip() if isinstance(v, str) else v for k, v in row.items()}
                )
                if len(rows) > 10000:
                    raise RuntimeError("monitor_row_limit")
            return rows
        finally:
            ibm_db.free_stmt(statement)


class History:
    """One aggregate per minute, bounded to 30 days; a collection gap is unknown."""

    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS minutes (minute INTEGER PRIMARY KEY, good INTEGER, bad INTEGER, point TEXT)"
        )
        self.db.commit()
        self.last_minute = None

    def add(self, sample):
        t = sample["collectedAt"] // 60000 * 60000
        ok = int(sample["collector"] == "available")
        m = sample["metrics"]
        point = dict(
            time=sample["collectedAt"],
            sql=m["sql"]["value"],
            response=m["response"]["value"],
            connections=m["connections"]["value"],
            iops=m["iops"]["value"],
            cache=m["cache"]["value"],
        )
        self.db.execute(
            "INSERT INTO minutes VALUES (?,?,?,?) ON CONFLICT(minute) DO UPDATE SET good=good+excluded.good,bad=bad+excluded.bad,point=excluded.point",
            (t, ok, 1 - ok, json.dumps(point)),
        )
        if t != self.last_minute:
            self.db.execute("DELETE FROM minutes WHERE minute<?", (t - 30 * 86400000,))
            self.last_minute = t
        self.db.commit()
        rows = self.db.execute(
            "SELECT point FROM minutes WHERE minute>=? ORDER BY minute", (t - 86400000,)
        ).fetchall()
        points = [json.loads(row[0]) for row in rows]
        # Chart gaps are explicit; a stopped collector is not a healthy interval.
        result = []
        for p in points:
            if result and p["time"] - result[-1]["time"] > 120000:
                result.append(
                    dict(
                        time=result[-1]["time"] + 60000,
                        sql=None,
                        response=None,
                        connections=None,
                        iops=None,
                        cache=None,
                    )
                )
            result.append(p)
        good, bad, start = self.db.execute(
            "SELECT COALESCE(SUM(good),0),COALESCE(SUM(bad),0),MIN(minute) FROM minutes"
        ).fetchone()
        return result, 100 * good / (good + bad) if good + bad else None, start

    def close(self):
        self.db.close()


class Collector:
    def __init__(
        self, reader, history, source_info=None, rate_window_seconds=RATE_WINDOW_SECONDS
    ):
        self.reader, self.history = reader, history
        self.source_info = source_info or DEFAULT_SOURCE
        self.rate_window_seconds = rate_window_seconds
        self.counter_samples = []
        self.query_previous = {}
        self.queries = []
        self.query_at = 0
        self.system = []
        self.system_at = 0
        self.sample = empty_sample(source_info=self.source_info)
        self.alerts = {}
        self.last_error = None

    def alert(self, key, message, at, severity="warning"):
        if key not in self.alerts:
            self.alerts[key] = dict(
                id=f"{key}-{at}", time=at, severity=severity, message=message
            )
        self.alerts = {
            k: v for k, v in self.alerts.items() if at - v["time"] < 86400000
        }

    def collect(self):
        started = time.monotonic()
        at = int(time.time() * 1000)
        try:
            database = self.reader.query("database")[0]
            connections = self.reader.query("connections")
            activities = self.reader.query("activities")
        except Exception as error:
            # No SQL text, credentials or driver exception messages in the public response.
            match = re.search(r"SQLSTATE[= :]+([A-Z0-9]{5})", str(error))
            self.last_error = match.group(1) if match else type(error).__name__
            self.reader.close()
            self.counter_samples = []
            self.sample = unavailable(self.sample, at, self.source_info)
            self.sample["history"], _, _ = self.history.add(self.sample)
            return self.sample
        self.last_error = None
        new_connections = {
            (row["MEMBER"], row["APPLICATION_HANDLE"], row["APPLICATION_ID"]): row
            for row in connections
        }
        latest = self.counter_samples[-1] if self.counter_samples else None
        if latest and (
            database["DB_CONN_TIME"] != latest[1]["DB_CONN_TIME"]
            or not 0 < started - latest[0] < 30
            or delta(database, latest[1], "TOTAL_APP_SECTION_EXECUTIONS") is None
        ):
            self.counter_samples = []
        self.counter_samples.append((started, database, new_connections))
        while (
            len(self.counter_samples) > 2
            and started - self.counter_samples[1][0] >= self.rate_window_seconds
        ):
            self.counter_samples.pop(0)
        baseline = self.counter_samples[0] if len(self.counter_samples) > 1 else None
        elapsed = started - baseline[0] if baseline else None
        valid = (
            baseline is not None
            and database["DB_CONN_TIME"] == baseline[1]["DB_CONN_TIME"]
            and elapsed is not None
            and 0 < elapsed < 30
        )
        previous = baseline[1] if valid else {}
        connection_previous = baseline[2] if valid else {}
        d = {
            k: delta(database, previous, k)
            for k in [
                "TOTAL_APP_SECTION_EXECUTIONS",
                "TOTAL_ACT_TIME",
                "ACT_COMPLETED_TOTAL",
                "POOL_DATA_L_READS",
                "POOL_INDEX_L_READS",
                *IOPS_COUNTERS,
                "DEADLOCKS",
                "LOCK_TIMEOUTS",
            ]
        }
        if any(
            d[k] is None
            for k in [
                "TOTAL_APP_SECTION_EXECUTIONS",
                "TOTAL_ACT_TIME",
                "ACT_COMPLETED_TOTAL",
            ]
        ):
            valid = False
            self.counter_samples = [(started, database, new_connections)]
            elapsed = None
        rate = d["TOTAL_APP_SECTION_EXECUTIONS"] / elapsed if valid else None
        response = (
            d["TOTAL_ACT_TIME"] / d["ACT_COMPLETED_TOTAL"]
            if valid and d["ACT_COMPLETED_TOTAL"]
            else None
        )
        cache = None
        if valid and all(
            d[k] is not None
            for k in [
                "POOL_DATA_L_READS",
                "POOL_INDEX_L_READS",
                "POOL_DATA_P_READS",
                "POOL_INDEX_P_READS",
            ]
        ):
            logical = d["POOL_DATA_L_READS"] + d["POOL_INDEX_L_READS"]
            physical = d["POOL_DATA_P_READS"] + d["POOL_INDEX_P_READS"]
            if logical and physical <= logical:
                cache = 100 * (1 - physical / logical)
        iops = (
            sum(d[counter] for counter in IOPS_COUNTERS) / elapsed
            if valid and all(d[counter] is not None for counter in IOPS_COUNTERS)
            else None
        )
        if at - self.system_at >= 10000:
            try:
                self.system = self.reader.query("system")
                self.system_at = at
            except Exception:
                self.system = []
                self.system_at = 0
        system = self.system[0] if self.system and at - self.system_at < 30000 else {}
        cpu = system.get("CPU_USAGE_TOTAL")
        if cpu is not None and not 0 <= cpu <= 100:
            cpu = None
        total, free = system.get("MEMORY_TOTAL"), system.get("MEMORY_FREE")
        memory = (
            100 * (1 - free / total)
            if total and free is not None and 0 <= free <= total
            else None
        )
        active = {
            a["APPLICATION_HANDLE"]
            for a in activities
            if a["ACTIVITY_STATE"] == "EXECUTING"
        }
        group_counts = {k: 0.0 for k, _ in GROUPS}
        for row in connections:
            key = (row["MEMBER"], row["APPLICATION_HANDLE"], row["APPLICATION_ID"])
            before = connection_previous.get(key)
            diff = (
                delta(row, before, "TOTAL_APP_SECTION_EXECUTIONS")
                if before and valid
                else None
            )
            if diff is not None:
                group_counts[classify(row)] += diff
        # Db2 updates database and connection counters at slightly different instants. A short
        # rolling window removes most roll-up flicker; a small measured skew is normalized to
        # the database total, while larger disagreement remains explicitly unavailable.
        attributed = sum(group_counts.values())
        total_executions = d["TOTAL_APP_SECTION_EXECUTIONS"] if valid else None
        attribution_ok = valid and (
            (total_executions == 0 and attributed == 0)
            or (
                total_executions > 0
                and attributed <= total_executions * (1 + ATTRIBUTION_TOLERANCE) + 2
            )
        )
        if attribution_ok:
            if attributed > total_executions:
                scale = total_executions / attributed
                group_counts = {
                    key: value * scale for key, value in group_counts.items()
                }
                attributed = total_executions
            group_counts["others"] += total_executions - attributed
        applications = []
        for key, name in GROUPS:
            group_rate = group_counts[key] / elapsed if attribution_ok else None
            share = (
                (100 * group_counts[key] / total_executions if total_executions else 0)
                if attribution_ok
                else None
            )
            applications.append(
                dict(
                    id=key,
                    name=name,
                    sqlExecutionsPerSecond=metric(key, group_rate, at),
                    sharePercent=share,
                )
            )
        if at - self.query_at >= 15000:
            try:
                query_rows = self.reader.query("queries")
                seconds = (at - self.query_at) / 1000 if self.query_at else None
                queries = []
                for row in query_rows:
                    before = self.query_previous.get(row["SQL_ID"])
                    if not before or not seconds or not valid:
                        continue
                    count = delta(row, before, "NUM_EXEC_WITH_METRICS")
                    duration = delta(row, before, "TOTAL_ACT_TIME")
                    runs = delta(row, before, "NUM_EXECUTIONS")
                    if count and duration is not None and runs is not None:
                        avg = duration / count
                        queries.append(
                            dict(
                                id=row["SQL_ID"],
                                statement="SQL " + row["SQL_ID"][-12:],
                                averageMs=avg,
                                executions=runs / seconds,
                                impact=(
                                    "Alto"
                                    if avg > 150
                                    else "Médio" if avg > 50 else "Baixo"
                                ),
                            )
                        )
                self.queries = sorted(
                    queries, key=lambda q: q["averageMs"], reverse=True
                )[:5]
                self.query_previous = {row["SQL_ID"]: row for row in query_rows}
                self.query_at = at
            except Exception:
                self.queries = []
                self.query_previous = {}
                self.query_at = at
        values = dict(
            cpu=cpu,
            memory=memory,
            connections=len(connections),
            executingSessions=len(active),
            users=len({r["SESSION_AUTH_ID"] for r in connections}),
            availability=None,
            response=response,
            iops=iops,
            cache=cache,
            sql=rate,
        )
        attention = (
            (cpu is not None and cpu > 85)
            or (response is not None and response > 150)
            or bool(d["DEADLOCKS"])
            or bool(d["LOCK_TIMEOUTS"])
        )
        if cpu is not None and cpu > 85:
            self.alert("cpu", "CPU do servidor acima de 85%.", at)
        if response is not None and response > 150:
            self.alert("response", "Tempo médio de atividade SQL acima de 150 ms.", at)
        if d["DEADLOCKS"]:
            self.alert("deadlocks", "Deadlock registrado no intervalo.", at)
        if d["LOCK_TIMEOUTS"]:
            self.alert("locks", "Espera por bloqueio expirou no intervalo.", at)
        self.sample = dict(
            id=at,
            collectedAt=at,
            lastGoodAt=at,
            source="db2",
            environment="production",
            scenario="normal",
            collector="available",
            database="online",
            health="attention" if attention else "healthy",
            metrics={
                k: metric(
                    k,
                    v,
                    at,
                    (
                        "not-applicable"
                        if k == "response" and valid and not d["ACT_COMPLETED_TOTAL"]
                        else None
                    ),
                )
                for k, v in values.items()
            },
            applications=applications,
            history=[],
            alerts=sorted(self.alerts.values(), key=lambda a: a["time"], reverse=True)[
                :8
            ],
            queries=self.queries,
            sessionGroups=[
                dict(
                    id=k,
                    label=n,
                    executing=sum(
                        r["APPLICATION_HANDLE"] in active
                        for r in connections
                        if classify(r) == k
                    ),
                )
                for k, n in GROUPS
            ],
            metadata=dict(
                sampleIntervalMs=2000,
                staleAfterMs=10000,
                **self.source_info,
                attributionAvailable=attribution_ok,
                collectorDurationMs=round((time.monotonic() - started) * 1000, 2),
                systemCollectedAt=self.system_at,
                queriesCollectedAt=self.query_at,
                includesMonitor=True,
                rateWindowMs=round(elapsed * 1000) if valid else None,
            ),
        )
        self.sample["metrics"]["cpu"]["collectedAt"] = self.system_at or at
        self.sample["metrics"]["memory"]["collectedAt"] = self.system_at or at
        hist, availability, start = self.history.add(self.sample)
        self.sample["history"] = hist
        self.sample["metrics"]["availability"] = metric(
            "availability", availability, at
        )
        self.sample["metadata"]["availabilitySince"] = start
        return self.sample


def read_config(filename="db2.json"):
    default = Path(os.environ.get("CREDENTIALS_DIRECTORY", "/etc/dashdb")) / filename
    configured = os.environ.get("DB2_CONFIG") if filename == "db2.json" else None
    return json.loads(Path(configured or default).read_text())
