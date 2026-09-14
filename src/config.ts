export const applications = [
  { id: "erp", name: "ERP", icon: "briefcase", initialRate: 2720 },
  { id: "portal", name: "PORTAL", icon: "globe", initialRate: 1440 },
  { id: "apis", name: "APIs", icon: "network", initialRate: 1200 },
  { id: "batch", name: "BATCH", icon: "calendar", initialRate: 960 },
  { id: "analytics", name: "BI / ANALYTICS", icon: "chart", initialRate: 640 },
  { id: "customer", name: "CUSTOMER", icon: "users", initialRate: 480 },
  { id: "others", name: "OUTROS", icon: "layers", initialRate: 560 },
] as const;

export const demoConfig = {
  seed: 260912,
  sampleIntervalMs: 2000,
  connectionLimit: 800,
  flow: {
    saturationSqlPerSecond: 6500,
    minWidth: 0.65,
    maxWidth: 3.6,
    maxParticlesPerPath: 12,
    totalParticleBudget: 56,
    durationSeconds: 3.6,
  },
  graphics: {
    maxDpr: 1.5,
    economicalDpr: 0.75,
    internalParticles: 90,
    economicalParticles: 32,
  },
  colors: {
    blue: "#326BFF",
    violet: "#7C3AFF",
    magenta: "#D946EF",
    cyan: "#25DBFF",
    healthy: "#00D9AA",
  },
};
export const scenarios = {
  normal: "Operação normal",
  erp: "Pico no ERP",
  slow: "Lentidão",
  idle: "Sem atividade",
  unavailable: "Coleta indisponível",
} as const;
export type Scenario = keyof typeof scenarios;
export type Environment = "production" | "staging";
export type Quality = "high" | "eco";
export type LiveSourceId = "huawei" | "cirion";

const query = new URLSearchParams(
  typeof window === "undefined" ? "" : window.location.search,
);
const requestedSeed = Number(query.get("seed") ?? demoConfig.seed);
const requestedTime = Date.parse(query.get("time") ?? "");
export const runtime = {
  seed: Number.isFinite(requestedSeed) ? requestedSeed : demoConfig.seed,
  frozen: query.get("freeze") === "1",
  svg: query.get("webgl") === "0",
  profile: query.get("profile") === "1",
  tv: typeof navigator !== "undefined" && /DashDB-TV\//.test(navigator.userAgent),
  liveSource: (query.get("db") === "huawei"
    ? "huawei"
    : "cirion") as LiveSourceId,
  clock: () => (Number.isFinite(requestedTime) ? requestedTime : Date.now()),
};
