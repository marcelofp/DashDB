"""Independent Db2 collectors with bounded latest-value SSE queues."""

import asyncio
from contextlib import asynccontextmanager
import ipaddress
import json
import logging
import os
from pathlib import Path
import socket
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from collector import Collector, Db2Reader, History, empty_sample, read_config, unavailable


log = logging.getLogger("dashdb.monitor")
SOURCE_SPECS = {
    "huawei": dict(
        sourceId="huawei",
        sourceLabel="Produção — Huawei",
        host="",
        database="PRODUCAO",
        platform="Linux",
        location="Huawei",
        credential="db2.json",
        history="history.sqlite",
    ),
    "cirion": dict(
        sourceId="cirion",
        sourceLabel="Produção — AIX — Cirion",
        host="",
        database="PRODUCAO",
        platform="AIX",
        location="Cirion",
        credential="db2-aix.json",
        history="history-cirion.sqlite",
    ),
}


def public_spec(source_id, config=None):
    result = {
        key: value
        for key, value in SOURCE_SPECS[source_id].items()
        if key not in {"credential", "history"}
    }
    if config:
        result["host"] = config.get("host", result["host"])
        result["database"] = config.get("database", result["database"])
    return result


subscribers = {source_id: set() for source_id in SOURCE_SPECS}
latest = {
    source_id: empty_sample(source_info=public_spec(source_id))
    for source_id in SOURCE_SPECS
}
collectors = {}
tasks = []
allowed = [
    ipaddress.ip_network(network)
    for network in os.environ.get(
        "ALLOWED_NETWORKS",
        "127.0.0.0/8,172.16.0.0/12,10.0.0.0/8,192.168.0.0/16,::1/128",
    ).split(",")
]


def notify(message):
    address = os.environ.get("NOTIFY_SOCKET")
    if not address:
        return
    if address.startswith("@"):
        address = "\0" + address[1:]
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as client:
        client.sendto(message.encode(), address)


def snapshot(source_id="huawei"):
    sample = latest[source_id]
    return (
        unavailable(sample, source_info=public_spec(source_id))
        if int(time.time() * 1000) - sample["collectedAt"] > 10000
        else sample
    )


async def loop(source_id, source_collector):
    while True:
        started = time.monotonic()
        try:
            latest[source_id] = await asyncio.to_thread(source_collector.collect)
            if source_collector.last_error:
                log.warning(
                    "Db2 collection unavailable; source=%s category=%s",
                    source_id,
                    source_collector.last_error,
                )
            notify("WATCHDOG=1")
        except Exception as error:
            log.error(
                "Collection failed; source=%s category=%s",
                source_id,
                type(error).__name__,
            )
            latest[source_id] = unavailable(
                latest[source_id], source_info=public_spec(source_id)
            )
        for queue in tuple(subscribers[source_id]):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(latest[source_id])
        await asyncio.sleep(max(0.1, 2 - (time.monotonic() - started)))


@asynccontextmanager
async def lifespan(app):
    state = Path(os.environ.get("STATE_DIRECTORY", "/var/lib/dashdb"))
    for source_id, spec in SOURCE_SPECS.items():
        try:
            config = read_config(spec["credential"])
        except FileNotFoundError:
            log.warning("Db2 source disabled; source=%s credential=missing", source_id)
            continue
        source_collector = Collector(
            Db2Reader(config),
            History(state / spec["history"]),
            public_spec(source_id, config),
        )
        collectors[source_id] = source_collector
        tasks.append(asyncio.create_task(loop(source_id, source_collector)))
    notify("READY=1")
    yield
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    for source_collector in collectors.values():
        source_collector.reader.close()
        source_collector.history.close()
    tasks.clear()
    collectors.clear()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def restrict_network(request, call_next):
    try:
        address = ipaddress.ip_address(request.client.host)
    except ValueError:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if not any(address in network for network in allowed):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "
        "worker-src 'self' blob:; frame-ancestors 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/sources")
async def sources():
    result = []
    for source_id in SOURCE_SPECS:
        sample = snapshot(source_id)
        descriptor = public_spec(source_id)
        metadata = sample.get("metadata", {})
        for key in ("host", "database", "sourceLabel", "platform", "location"):
            if metadata.get(key):
                descriptor[key] = metadata[key]
        result.append(
            dict(
                **descriptor,
                configured=source_id in collectors,
                collector=sample["collector"],
            )
        )
    return result


@app.get("/api/health")
async def health(source: str = "huawei"):
    if source not in SOURCE_SPECS:
        return JSONResponse({"error": "unknown_source"}, status_code=404)
    sample = snapshot(source)
    return JSONResponse(
        dict(
            service="dashdb",
            source=source,
            configured=source in collectors,
            collector=sample["collector"],
            database=sample["database"],
            collectedAt=sample["collectedAt"],
            lastGoodAt=sample["lastGoodAt"],
            subscribers=len(subscribers[source]),
        ),
        status_code=200 if sample["collector"] == "available" else 503,
    )


@app.get("/api/snapshot")
async def get_snapshot(source: str = "huawei"):
    if source not in SOURCE_SPECS:
        return JSONResponse({"error": "unknown_source"}, status_code=404)
    return snapshot(source)


@app.get("/api/events")
async def events(request: Request, source: str = "huawei"):
    if source not in SOURCE_SPECS:
        return JSONResponse({"error": "unknown_source"}, status_code=404)
    source_subscribers = subscribers[source]
    if len(source_subscribers) >= 32:
        return JSONResponse({"error": "client_limit"}, status_code=503)
    queue = asyncio.Queue(maxsize=1)
    source_subscribers.add(queue)

    async def stream():
        try:
            yield "retry: 3000\n\n"
            yield "event: snapshot\ndata: " + json.dumps(
                snapshot(source), separators=(",", ":"), allow_nan=False
            ) + "\n\n"
            while not await request.is_disconnected():
                try:
                    sample = await asyncio.wait_for(queue.get(), timeout=5)
                except asyncio.TimeoutError:
                    sample = snapshot(source)
                yield "event: snapshot\ndata: " + json.dumps(
                    sample, separators=(",", ":"), allow_nan=False
                ) + "\n\n"
        finally:
            source_subscribers.discard(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache, no-transform"},
    )


static = Path(
    os.environ.get("STATIC_DIRECTORY", "/opt/dashdb/current/dist")
)
if static.exists():
    app.mount("/", StaticFiles(directory=static, html=True), name="dashboard")
