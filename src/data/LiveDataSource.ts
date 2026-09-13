import { runtime, type LiveSourceId } from "../config";
import type {
  DashboardDataSource,
  DashboardSample,
  Metric,
  MonitorSource,
} from "./contracts";

const buildEnv = import.meta.env ?? {};

export const liveSources: readonly MonitorSource[] = [
  {
    id: "huawei",
    label: "Produção — Huawei",
    host: buildEnv.VITE_DB2_HUAWEI_HOST ?? "",
    database: buildEnv.VITE_DB2_HUAWEI_DATABASE ?? "PRODUCAO",
    platform: "Linux",
    location: "Huawei",
  },
  {
    id: "cirion",
    label: "Produção — AIX — Cirion",
    host: buildEnv.VITE_DB2_CIRION_HOST ?? "",
    database: buildEnv.VITE_DB2_CIRION_DATABASE ?? "PRODUCAO",
    platform: "AIX",
    location: "Cirion",
  },
];
const sourceById = new Map(liveSources.map((source) => [source.id, source]));

const units = {
  cpu: "%",
  memory: "%",
  connections: "count",
  executingSessions: "count",
  users: "count",
  availability: "%",
  response: "ms",
  iops: "IOPS",
  cache: "%",
  sql: "SQL/s",
} as const;
export function emptyLiveSample(sourceId: LiveSourceId = "huawei"): DashboardSample {
  const at = Date.now();
  const descriptor = sourceById.get(sourceId)!;
  return {
    id: at,
    collectedAt: at,
    lastGoodAt: 0,
    source: "db2",
    environment: "production",
    scenario: "unavailable",
    collector: "unavailable",
    database: "unknown",
    health: "unknown",
    metrics: Object.fromEntries(
      Object.entries(units).map(([id, unit]) => [
        id,
        {
          id,
          value: null,
          unit,
          collectedAt: at,
          source: "db2",
          quality: "unavailable",
        },
      ]),
    ) as DashboardSample["metrics"],
    applications: [],
    history: [],
    queries: [],
    sessionGroups: [],
    alerts: [],
    metadata: {
      sampleIntervalMs: 2000,
      staleAfterMs: 10000,
      host: descriptor.host,
      database: descriptor.database,
      sourceId: descriptor.id,
      sourceLabel: descriptor.label,
      platform: descriptor.platform,
      location: descriptor.location,
    },
  };
}

function validMetric(v: unknown): v is Metric {
  if (!v || typeof v !== "object") return false;
  const m = v as Metric;
  return (
    (m.value === null ||
      (typeof m.value === "number" && Number.isFinite(m.value))) &&
    m.source === "db2" &&
    Number.isFinite(m.collectedAt) &&
    ["good", "unavailable", "not-applicable"].includes(m.quality)
  );
}
export function isLiveSample(v: unknown): v is DashboardSample {
  if (!v || typeof v !== "object") return false;
  const s = v as DashboardSample;
  return (
    s.source === "db2" &&
    Number.isFinite(s.id) &&
    Number.isFinite(s.collectedAt) &&
    Number.isFinite(s.lastGoodAt) &&
    ["available", "unavailable"].includes(s.collector) &&
    ["online", "unknown"].includes(s.database) &&
    ["healthy", "attention", "unknown"].includes(s.health) &&
    !!s.metrics &&
    Object.keys(units).every((k) =>
      validMetric(s.metrics[k as keyof typeof units]),
    ) &&
    Array.isArray(s.applications) &&
    s.applications.length <= 7 &&
    s.applications.every(
      (a) =>
        /^[a-z0-9_-]+$/.test(a.id) &&
        validMetric(a.sqlExecutionsPerSecond) &&
        (a.sharePercent === null || Number.isFinite(a.sharePercent)),
    ) &&
    Array.isArray(s.history) &&
    s.history.length <= 3000 &&
    s.history.every(
      (p) =>
        Number.isFinite(p.time) &&
        [p.sql, p.response, p.connections, p.iops, p.cache].every(
          (n) => n === null || (typeof n === "number" && Number.isFinite(n)),
        ),
    ) &&
    Array.isArray(s.alerts) &&
    s.alerts.every(
      (a) =>
        typeof a.id === "string" &&
        typeof a.message === "string" &&
        Number.isFinite(a.time) &&
        ["info", "warning", "critical"].includes(a.severity),
    ) &&
    Array.isArray(s.queries) &&
    s.queries.every(
      (q) =>
        typeof q.id === "string" &&
        typeof q.statement === "string" &&
        [q.averageMs, q.executions].every(
          (n) => n === null || Number.isFinite(n),
        ),
    ) &&
    Array.isArray(s.sessionGroups) &&
    s.sessionGroups.every(
      (g) =>
        typeof g.id === "string" &&
        typeof g.label === "string" &&
        (g.executing === null || Number.isFinite(g.executing)),
    ) &&
    (!s.metadata?.sourceId || sourceById.has(s.metadata.sourceId))
  );
}

export class LiveDataSource implements DashboardDataSource {
  private listeners = new Set<() => void>();
  private sample = emptyLiveSample();
  private stream?: EventSource;
  private timer?: ReturnType<typeof setInterval>;
  private receivedAt = 0;
  private sourceId: LiveSourceId;
  constructor(private base = "/api", initialSource = runtime.liveSource) {
    this.sourceId = initialSource;
    this.sample = emptyLiveSample(initialSource);
  }
  getSources = () => liveSources;
  getSource = () => this.sourceId;
  setSource = (sourceId: LiveSourceId) => {
    if (!sourceById.has(sourceId) || sourceId === this.sourceId) return;
    this.stop();
    this.sourceId = sourceId;
    this.sample = emptyLiveSample(sourceId);
    const url = new URL(window.location.href);
    url.searchParams.set("db", sourceId);
    window.history.replaceState(null, "", url);
    this.emit();
    if (this.listeners.size) this.start();
  };
  getSnapshot = () => this.sample;
  private emit = () => this.listeners.forEach((listener) => listener());
  private markUnavailable = () => {
    if (this.sample.collector === "unavailable") return;
    const previous = this.sample;
    this.sample = {
      ...emptyLiveSample(this.sourceId),
      lastGoodAt: previous.lastGoodAt,
      history: previous.history,
      metadata: previous.metadata,
      applications: previous.applications.map((a) => ({
        ...a,
        sharePercent: null,
        sqlExecutionsPerSecond: {
          ...a.sqlExecutionsPerSecond,
          value: null,
          quality: "unavailable",
        },
      })),
      alerts: [
        {
          id: "stream-unavailable",
          time: Date.now(),
          severity: "warning",
          message: "Atualização interrompida. Aguardando reconexão.",
        },
      ],
    };
    this.emit();
  };
  private start = () => {
    if (this.stream) return;
    const connectedSource = this.sourceId;
    this.receivedAt = 0;
    this.stream = new EventSource(
      `${this.base}/events?source=${encodeURIComponent(connectedSource)}`,
    );
    this.stream.addEventListener("snapshot", (event) => {
      if (connectedSource !== this.sourceId) return;
      try {
        const next: unknown = JSON.parse((event as MessageEvent).data);
        if (
          !isLiveSample(next) ||
          next.metadata?.sourceId !== connectedSource
        ) {
          this.markUnavailable();
          return;
        }
        if (
          next.collector === "available" &&
          Date.now() - next.collectedAt > 10000
        ) {
          this.markUnavailable();
          return;
        }
        this.receivedAt = performance.now();
        this.sample = next;
        this.emit();
      } catch {
        this.markUnavailable();
      }
    });
    this.stream.onerror = this.markUnavailable;
    this.timer = setInterval(() => {
      if (performance.now() - this.receivedAt > 10000) this.markUnavailable();
    }, 1000);
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.start();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stop();
    };
  };
  private stop = () => {
    this.stream?.close();
    this.stream = undefined;
    clearInterval(this.timer);
    this.timer = undefined;
    this.receivedAt = 0;
  };
  dispose = () => {
    this.stop();
    this.listeners.clear();
  };
}
