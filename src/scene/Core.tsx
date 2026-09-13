import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { CircleCheck, Radio, CircleHelp } from "lucide-react";
import { runtime, type Quality } from "../config";
import type { DashboardSample } from "../data/contracts";
import { coreActivity } from "./activity";
import s from "../styles/Dashboard.module.css";

const CoreScene = lazy(() => import("./CoreScene"));
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function supportsWebGL() {
  if (runtime.svg) return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
export function FallbackCore() {
  return (
    <svg
      className={s.svgCore}
      data-testid="svg-fallback"
      viewBox="0 0 640 520"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="shell" x1="0" x2="1">
          <stop stopColor="#147aff" stopOpacity=".28" />
          <stop offset=".5" stopColor="#102670" stopOpacity=".2" />
          <stop offset="1" stopColor="#25dbff" stopOpacity=".4" />
        </linearGradient>
        <filter id="core-glow">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <g fill="none" stroke="#326bff">
        {[205, 185, 162, 140, 115].map((r, i) => (
          <ellipse
            key={r}
            cx="320"
            cy={422 - i * 4}
            rx={r}
            ry={r * 0.25}
            strokeWidth={i === 0 ? 3 : 1.5}
          />
        ))}
        <path
          d="M210 165V348C210 390 430 390 430 348V165"
          fill="url(#shell)"
          stroke="#25dbff"
          strokeWidth="2.5"
        />
        {Array.from({ length: 12 }, (_, i) => (
          <ellipse
            key={i}
            cx="320"
            cy={165 + i * 17}
            rx="110"
            ry="29"
            opacity={i === 0 ? 1 : 0.28}
          />
        ))}
        <g className={s.svgRing}>
          {[112, 93, 70, 46].map((r) => (
            <ellipse
              key={r}
              cx="320"
              cy="165"
              rx={r}
              ry={r * 0.26}
              stroke="#25dbff"
              strokeWidth="2"
            />
          ))}
        </g>
        <ellipse
          cx="320"
          cy="165"
          rx="112"
          ry="30"
          stroke="#25dbff"
          strokeWidth="7"
          filter="url(#core-glow)"
        />
        <ellipse
          cx="320"
          cy="420"
          rx="155"
          ry="36"
          stroke="#7c3aff"
          strokeWidth="6"
          filter="url(#core-glow)"
        />
      </g>
    </svg>
  );
}
export default function Core({
  sample,
  quality,
  moving,
}: {
  sample: DashboardSample;
  quality: Quality;
  moving: boolean;
}) {
  const [webgl, setWebgl] = useState(supportsWebGL);
  const sql = sample.metrics.sql.value;
  const executing = sample.metrics.executingSessions.value;
  const activity = sample.collector === "unavailable" ? 0 : coreActivity(sql, executing);
  const unknown = sample.collector === "unavailable" || sample.database === "unknown";
  const status =
    unknown ? "NÃO CONFIRMADO" : activity === 0 ? "EM REPOUSO" : "ONLINE";
  const Icon = unknown ? CircleHelp : activity === 0 ? Radio : CircleCheck;
  return (
    <div
      className={s.core}
      data-core
      data-quality={quality}
      data-renderer={webgl ? "webgl" : "svg"}
      data-activity={activity}
      style={{ "--activity": activity } as React.CSSProperties}
    >
      <div className={s.coreHalo} />
      <div className={s.floor} />
      <div className={s.orbitBackdrop} />
      <div className={s.coreReticle} aria-hidden="true">
        <div className={s.reticleRing} />
        <div className={s.reticleTicks} />
        <span className={s.reticleLabel}>DATABASE ENGINE</span>
        <span className={s.reticleLabel}>DB2 / LUW</span>
      </div>
      <div className={s.scene}>
        <SceneBoundary fallback={<FallbackCore />}>
          <Suspense fallback={<FallbackCore />}>
            {webgl ? (
              <CoreScene
                activity={activity}
                quality={quality}
                moving={moving}
                onFailure={() => setWebgl(false)}
              />
            ) : (
              <FallbackCore />
            )}
          </Suspense>
        </SceneBoundary>
      </div>
      <span className={s.coreTarget} data-core-target aria-hidden="true" />
      <span className={s.sessionTarget} data-session-target aria-hidden="true" />
      <div className={s.coreLabel}>
        <strong>DB2</strong>
        <span className={unknown ? s.warning : s.good}>
          <Icon aria-hidden="true" />
          {status}
        </span>
      </div>
      <div className={s.coreCaption}>
        <span>
          {unknown
            ? "SEM TELEMETRIA ATUAL"
            : activity === 0
              ? "AGUARDANDO ATIVIDADE"
              : "PROCESSANDO EM TEMPO REAL"}
        </span>
        <small>
          {unknown
            ? "Coleta indisponível · banco sem confirmação"
            : sample.source === "db2"
              ? "PRODUCAO   /   TELEMETRIA NATIVA DB2"
              : "ESTÁVEL   /   REPLICADO   /   PROTEGIDO"}
        </small>
      </div>
    </div>
  );
}
