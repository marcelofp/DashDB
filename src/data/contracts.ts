import type { Environment, LiveSourceId, Scenario } from "../config";

export interface MonitorSource {
  id: LiveSourceId;
  label: string;
  host: string;
  database: string;
  platform: string;
  location: string;
}

export type Unit = "%" | "ms" | "SQL/s" | "IOPS" | "count";
export type InformationQuality = "good" | "unavailable" | "not-applicable";
export interface Metric {
  id: string;
  value: number | null;
  unit: Unit;
  collectedAt: number;
  source: "simulated" | "db2";
  quality: InformationQuality;
}
export interface AppActivity {
  id: string;
  name?: string;
  sqlExecutionsPerSecond: Metric;
  sharePercent: number | null;
}
export interface HistoryPoint {
  time: number;
  sql: number | null;
  response: number | null;
  connections: number | null;
  iops: number | null;
  cache: number | null;
}
export interface Alert {
  id: string;
  time: number;
  severity: "info" | "warning" | "critical";
  message: string;
}
export interface QueryRow {
  id: string;
  statement: string;
  averageMs: number | null;
  executions: number | null;
  impact: "Alto" | "Médio" | "Baixo";
}
export interface SessionGroup {
  id: string;
  label: string;
  executing: number | null;
}
export interface DashboardSample {
  id: number;
  collectedAt: number;
  lastGoodAt: number;
  source: "simulated" | "db2";
  metadata?: {
    sampleIntervalMs: number;
    staleAfterMs: number;
    host: string;
    database: string;
    availabilitySince?: number;
    collectorDurationMs?: number;
    attributionAvailable?: boolean;
    rateWindowMs?: number | null;
    sourceId?: LiveSourceId;
    sourceLabel?: string;
    platform?: string;
    location?: string;
  };
  environment: Environment;
  scenario: Scenario;
  collector: "available" | "unavailable";
  database: "online" | "unknown";
  health: "healthy" | "attention" | "unknown";
  metrics: Record<
    | "cpu"
    | "memory"
    | "connections"
    | "executingSessions"
    | "users"
    | "availability"
    | "response"
    | "iops"
    | "cache"
    | "sql",
    Metric
  >;
  applications: AppActivity[];
  history: HistoryPoint[];
  alerts: Alert[];
  queries: QueryRow[];
  sessionGroups: SessionGroup[];
}
export interface DashboardDataSource {
  getSnapshot(): DashboardSample;
  subscribe(listener: () => void): () => void;
  dispose(): void;
  getSources?(): readonly MonitorSource[];
  getSource?(): LiveSourceId;
  setSource?(source: LiveSourceId): void;
}
export interface DemoControls {
  setScenario(scenario: Scenario): void;
  setEnvironment(environment: Environment): void;
  setPaused(paused: boolean): void;
}
