import {
  applications,
  demoConfig,
  type Environment,
  type Scenario,
} from "../config";
import type {
  Alert,
  DashboardSample,
  HistoryPoint,
  Metric,
  Unit,
} from "./contracts";

export function randomAt(seed: number, index: number) {
  let x = (seed + Math.imul(index + 1, 0x6d2b79f5)) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
export function sharesOf(rates: number[]): number[] {
  const total = rates.reduce((a, b) => a + b, 0);
  if (!total) return rates.map(() => 0);
  const exact = rates.map((rate) => (rate / total) * 100);
  const whole = exact.map(Math.floor);
  const order = exact
    .map((v, i) => ({ i, fraction: v - whole[i] }))
    .sort((a, b) => b.fraction - a.fraction);
  const remaining = 100 - whole.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) whole[order[i].i]++;
  return whole;
}
export function flowIntensity(rate: number | null): number {
  return rate === null
    ? 0
    : Math.min(1, Math.max(0, rate) / demoConfig.flow.saturationSqlPerSecond) **
        0.7;
}
export function flowIntensities(rates: (number | null)[]): number[] {
  const peak = Math.max(0, ...rates.map((rate) => rate ?? 0));
  if (!peak) return rates.map(() => 0);
  return rates.map((rate) => {
    if (rate === null || rate <= 0) return 0;
    const relative = (rate / peak) ** 0.7;
    return relative * (0.6 + flowIntensity(rate) * 0.4);
  });
}
export function particleCounts(rates: (number | null)[], economical = false) {
  const budget = economical ? 28 : demoConfig.flow.totalParticleBudget;
  const desired = flowIntensities(rates).map((intensity) =>
    intensity > 0
      ? Math.max(
          1,
          Math.round(intensity * demoConfig.flow.maxParticlesPerPath),
        )
      : 0,
  );
  const total = desired.reduce((a, b) => a + b, 0);
  if (total <= budget) return desired;
  const active = desired.filter((n) => n > 0).length;
  return desired.map((n) =>
    n === 0
      ? 0
      : 1 + Math.floor(((n - 1) * (budget - active)) / (total - active)),
  );
}
export function buildHistory(
  seed: number,
  time: number,
  environment: Environment,
): HistoryPoint[] {
  return Array.from({ length: 1440 }, (_, i) => {
    const phase = i / 1440;
    const wave =
      0.3 +
      0.55 * Math.exp(-(((phase - 0.44) / 0.08) ** 2)) +
      0.17 * Math.sin(phase * 19) ** 2 +
      randomAt(seed, i) * 0.13;
    const factor = environment === "staging" ? 0.35 : 1;
    return {
      time: time - (1440 - i) * 60000,
      sql: Math.round(wave * 20000 * factor),
      response: Math.round(28 + wave * 28),
      connections: Math.round(wave * 710 * factor),
      iops: Math.round(wave * 29000 * factor),
      cache: +(99.4 - wave * 1.1).toFixed(2),
    };
  });
}
export function createSample(options: {
  seed: number;
  step: number;
  time: number;
  scenario: Scenario;
  environment: Environment;
  previous?: DashboardSample;
}): DashboardSample {
  const { seed, step, time, scenario, environment, previous } = options;
  const missing = scenario === "unavailable";
  const idle = scenario === "idle";
  const factor = environment === "staging" ? 0.35 : 1;
  const rates = applications.map((app, i) =>
    Math.round(
      app.initialRate *
        factor *
        (idle ? 0 : scenario === "erp" && i === 0 ? 3.6 : 1) *
        (step === 0 ? 1 : 0.96 + randomAt(seed, step * 7 + i) * 0.08),
    ),
  );
  const total = rates.reduce((a, b) => a + b, 0);
  const load = total / 8000;
  const shares = sharesOf(rates);
  const metric = (id: string, value: number | null, unit: Unit): Metric => ({
    id,
    value: missing ? null : value,
    unit,
    collectedAt: time,
    source: "simulated",
    quality: missing
      ? "unavailable"
      : value === null
        ? "not-applicable"
        : "good",
  });
  const response = idle
    ? null
    : scenario === "slow"
      ? Math.round(180 + load * 24)
      : Math.round(30 + load * 12);
  const connections = Math.min(
    demoConfig.connectionLimit,
    Math.round(62 * factor + load * 280),
  );
  const sessions = idle
    ? 0
    : Math.min(
        connections,
        Math.round(load * 92 * (scenario === "slow" ? 1.6 : 1)),
      );
  const iops = Math.round(idle ? 360 * factor : 12400 * load);
  const cache = idle
    ? 98.7
    : +(scenario === "slow" ? 96.2 : 99.1 - load * 0.4).toFixed(1);
  const point: HistoryPoint = {
    time,
    sql: missing ? null : total,
    response: missing ? null : response,
    connections: missing ? null : connections,
    iops: missing ? null : iops,
    cache: missing ? null : cache,
  };
  const history = [
    ...(previous?.history ?? buildHistory(seed, time, environment)),
    point,
  ]
    .filter((p) => p.time >= time - 86400000)
    .slice(-45000);
  const alerts: Alert[] = [
    ...(scenario === "slow"
      ? [
          {
            id: "slow",
            time,
            severity: "critical" as const,
            message: "Tempo SQL acima de 150 ms",
          },
          {
            id: "cache",
            time,
            severity: "warning" as const,
            message: "Cache hit abaixo de 98%",
          },
        ]
      : []),
    ...(scenario === "erp"
      ? [
          {
            id: "erp",
            time,
            severity: "info" as const,
            message: "Pico de atividade no ERP",
          },
        ]
      : []),
    ...(missing
      ? [
          {
            id: "collector",
            time,
            severity: "warning" as const,
            message: "Coleta indisponível · estado não confirmado",
          },
        ]
      : []),
    ...(idle
      ? [
          {
            id: "idle",
            time,
            severity: "info" as const,
            message: "Sem execuções SQL no intervalo",
          },
        ]
      : []),
    {
      id: "backup",
      time:
        previous?.alerts.find((a) => a.id === "backup")?.time ?? time - 3600000,
      severity: "info",
      message: "Backup de demonstração concluído",
    },
    {
      id: "replication",
      time:
        previous?.alerts.find((a) => a.id === "replication")?.time ??
        time - 8400000,
      severity: "info",
      message: "Replicação simulada sincronizada",
    },
    {
      id: "start",
      time:
        previous?.alerts.find((a) => a.id === "start")?.time ?? time - 12000000,
      severity: "info",
      message: "Monitoramento de demonstração iniciado",
    },
  ];
  const groupCounts = [0.36, 0.24, 0.18, 0.14].map((n) =>
    Math.floor(sessions * n),
  );
  groupCounts.push(sessions - groupCounts.reduce((a, b) => a + b, 0));
  return {
    id: step,
    collectedAt: time,
    lastGoodAt: missing ? (previous?.lastGoodAt ?? time) : time,
    source: "simulated",
    scenario,
    environment,
    collector: missing ? "unavailable" : "available",
    database: missing ? "unknown" : "online",
    health: missing ? "unknown" : scenario === "slow" ? "attention" : "healthy",
    metrics: {
      cpu: metric(
        "server.cpu",
        idle
          ? 6
          : Math.min(
              96,
              Math.round(18 + load * 20 + (scenario === "slow" ? 20 : 0)),
            ),
        "%",
      ),
      memory: metric(
        "server.memory",
        idle ? 54 : Math.min(93, Math.round(61 + load * 6)),
        "%",
      ),
      connections: metric("db.connections.open", connections, "count"),
      executingSessions: metric("db.sessions.executing", sessions, "count"),
      users: metric(
        "db.users.connected",
        Math.min(connections, Math.round((connections * 278) / 342)),
        "count",
      ),
      availability: metric("db.availability.30d", 99.98, "%"),
      response: metric("db.sql.averageExecution", response, "ms"),
      iops: metric("storage.iops", iops, "IOPS"),
      cache: metric("db.cache.hit", cache, "%"),
      sql: metric("db.sql.executions", total, "SQL/s"),
    },
    applications: applications.map((app, i) => ({
      id: app.id,
      sqlExecutionsPerSecond: metric(`app.${app.id}.sql`, rates[i], "SQL/s"),
      sharePercent: missing ? null : shares[i],
    })),
    history,
    alerts,
    queries: [
      "SELECT · DEMO_A93F",
      "UPDATE · DEMO_782D",
      "MERGE · DEMO_4C9A",
      "SELECT · DEMO_108F",
      "DELETE · DEMO_6678",
    ].map((statement, i) => ({
      id: `demo-query-${i}`,
      statement,
      averageMs:
        missing || response === null
          ? null
          : +(response * [3.05, 1.95, 1.6, 1.42, 0.98][i]).toFixed(1),
      executions: missing
        ? null
        : Math.round(total * [0.025, 0.018, 0.012, 0.021, 0.008][i]),
      impact: i < 2 ? "Alto" : i < 4 ? "Médio" : "Baixo",
    })),
    sessionGroups: [
      "APP_DEMO",
      "WEB_DEMO",
      "BATCH_DEMO",
      "ANALYTICS",
      "DBA_DEMO",
    ].map((label, i) => ({
      id: label,
      label,
      executing: missing ? null : groupCounts[i],
    })),
  };
}

export function periodHistory(history: HistoryPoint[], hours: number) {
  if (!history.length) return [];
  const cutoff = history.at(-1)!.time - hours * 3600000;
  const filtered = history.filter((p) => p.time >= cutoff);
  // Aggregate into at most 90 buckets, preserving the actual latest sample and gaps.
  if (filtered.length <= 90) return filtered;
  const stride = Math.ceil((filtered.length - 1) / 89);
  return [
    ...filtered.filter((_, i) => i < filtered.length - 1 && i % stride === 0),
    filtered.at(-1)!,
  ];
}
export function trend(
  history: HistoryPoint[],
  key: "response" | "connections" | "iops" | "cache",
  hours: number,
): number | null {
  const points = periodHistory(history, hours);
  if (points.length < 2) return null;
  if (points.at(-1)!.time - points[0].time < hours * 3600000 * 0.95) return null;
  const first = points[0][key],
    last = points.at(-1)![key];
  return first === null || last === null || first === 0
    ? null
    : ((last - first) / first) * 100;
}
