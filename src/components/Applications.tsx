import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  Globe,
  Layers,
  Network,
  Users,
  X,
} from "lucide-react";
import { applications } from "../config";
import type { DashboardSample } from "../data/contracts";
import { flowIntensities } from "../data/simulation";
import { number, Panel } from "./Primitives";
import s from "../styles/Dashboard.module.css";

const icons = {
  briefcase: BriefcaseBusiness,
  globe: Globe,
  network: Network,
  calendar: CalendarDays,
  chart: ChartNoAxesCombined,
  users: Users,
  layers: Layers,
};
const liveIcons = {
  creaone_oniros: Globe,
  creaone_egeos: Users,
  creanet: Network,
  certidoes: BriefcaseBusiness,
  retorno: CalendarDays,
  services: ChartNoAxesCombined,
  others: Layers,
};
export default function Applications({
  sample,
  selected,
  setSelected,
  setHighlighted,
}: {
  sample: DashboardSample;
  selected: string | null;
  setSelected: (id: string | null) => void;
  setHighlighted: (id: string | null) => void;
}) {
  const current = sample.applications.find((a) => a.id === selected);
  const rates = sample.applications.map(
    (app) => app.sqlExecutionsPerSecond.value,
  );
  const intensities = flowIntensities(rates);
  const peakRate = Math.max(0, ...rates.map((rate) => rate ?? 0));
  return (
    <Panel
      title="Aplicações que acessam o banco"
      icon={Activity}
      className={s.applications}
    >
      <div className={s.appColumns}>
        <span>APLICAÇÃO</span>
        <span>PARTICIPAÇÃO</span>
        <span>SQL/s</span>
      </div>
      <div className={s.appRows}>
        {sample.applications.map((app, i) => {
          const config =
              applications.find((a) => a.id === app.id) ??
              applications[i] ??
              applications[6],
            label = app.name ?? config.name,
            Icon = liveIcons[app.id as keyof typeof liveIcons] ?? icons[config.icon],
            intensity = intensities[i],
            rate = app.sqlExecutionsPerSecond.value;
          const color =
            rate !== null && rate > 0 && rate === peakRate
              ? "var(--magenta)"
              : intensity > 0.2
                ? "var(--violet)"
                : "var(--blue)";
          return (
            <button
              key={app.id}
              className={`${s.appRow} ${selected === app.id ? s.appSelected : ""}`}
              aria-pressed={selected === app.id}
              aria-label={`${label}: ${number(app.sqlExecutionsPerSecond.value)} SQL/s, ${number(app.sharePercent)} por cento`}
              onClick={() => setSelected(selected === app.id ? null : app.id)}
              onMouseEnter={() => setHighlighted(app.id)}
              onMouseLeave={() => setHighlighted(null)}
              onFocus={() => setHighlighted(app.id)}
              onBlur={() => setHighlighted(null)}
              data-testid={`app-${app.id}`}
            >
              <Icon aria-hidden="true" style={{ color }} />
              <span className={s.appName}>{label}</span>
              <span className={s.appBar}>
                <span
                  style={{
                    width: `${app.sharePercent ?? 0}%`,
                    background: `linear-gradient(90deg, ${color}, ${color})`,
                  }}
                />
              </span>
              <span className={s.share}>
                {number(app.sharePercent)}
                {app.sharePercent === null ? "" : "%"}
              </span>
              <span className={s.appRate}>
                {number(
                  app.sqlExecutionsPerSecond.value,
                  sample.source === "db2" ? 2 : 0,
                )}
              </span>
              <ChevronRight className={s.appArrow} aria-hidden="true" />
              <i data-origin={app.id} className={s.flowOrigin} />
            </button>
          );
        })}
      </div>
      <div className={s.appTotal}>
        <span>Total de execuções</span>
        <strong data-testid="total-sql">
          {number(sample.metrics.sql.value, sample.source === "db2" ? 2 : 0)}{" "}
          <small>SQL/s</small>
        </strong>
      </div>
      {current && (
        <div className={s.appContext} role="status">
          <div>
            <strong>
              {current.name ??
                applications.find((a) => a.id === selected)?.name}
            </strong>
            <span>
              {number(current.sqlExecutionsPerSecond.value)} SQL/s ·{" "}
              {number(current.sharePercent)}% do volume
            </span>
            <small>Fluxo agregado de execuções SQL</small>
          </div>
          <button
            onClick={() => setSelected(null)}
            aria-label="Fechar resumo da aplicação"
          >
            <X />
          </button>
        </div>
      )}
    </Panel>
  );
}
