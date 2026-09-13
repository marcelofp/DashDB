import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import s from "../styles/Dashboard.module.css";

export const number = (value: number | null, digits = 0) =>
  value === null
    ? "—"
    : value.toLocaleString("pt-BR", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
export const timeLabel = (time: number) =>
  new Date(time).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
export function Panel({
  title,
  icon: Icon,
  children,
  className = "",
  action,
  tone = "violet",
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  tone?: string;
}) {
  return (
    <section className={`${s.panel} ${className}`}>
      <div className={s.panelHeader}>
        <h2>
          <Icon aria-hidden="true" style={{ color: `var(--${tone})` }} />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Delta({
  value,
  lowerBetter = false,
  period = "1 h",
}: {
  value: number | null;
  lowerBetter?: boolean;
  period?: string;
}) {
  const Icon =
    value === null || Math.abs(value) < 0.5
      ? Minus
      : value < 0
        ? ArrowDown
        : ArrowUp;
  return (
    <div className={s.delta}>
      <span
        className={
          value === null
            ? s.muted
            : lowerBetter
              ? value <= 0
                ? s.good
                : s.warning
              : s.cyan
        }
      >
        <Icon aria-hidden="true" />
        {value === null
          ? "—"
          : `${Math.abs(value) < 0.5 ? "" : value > 0 ? "+" : ""}${number(Math.abs(value) < 0.5 ? 0 : value)}%`}
      </span>
      <small>{value === null ? "Sem comparação" : `vs. ${period} atrás`}</small>
    </div>
  );
}
export function Gauge({
  value,
  color,
  label,
}: {
  value: number | null;
  color: string;
  label: string;
}) {
  return (
    <div
      className={s.gauge}
      role="img"
      aria-label={`${label}: ${value === null ? "indisponível" : value + "%"}`}
      style={{ "--gauge-color": color } as CSSProperties}
    >
      <svg viewBox="0 0 240 143" aria-hidden="true">
        <defs>
          <linearGradient id={`gauge-${label}`}>
            <stop stopColor={color} />
            <stop
              offset="1"
              stopColor={color === "var(--magenta)" ? "#7c3aff" : "#326bff"}
            />
          </linearGradient>
        </defs>
        <path
          d="M 25 119 A 95 95 0 0 1 215 119"
          pathLength="100"
          fill="none"
          stroke="#25184c"
          strokeWidth="16"
        />
        <path
          d="M 25 119 A 95 95 0 0 1 215 119"
          pathLength="100"
          fill="none"
          stroke={`url(#gauge-${label})`}
          strokeWidth="16"
          strokeDasharray={`${value ?? 0} 100`}
        />
        <text x="10" y="142">
          0
        </text>
        <text x="214" y="142">
          100
        </text>
      </svg>
      <strong>
        {number(value)}
        <span>{value === null ? "" : "%"}</span>
      </strong>
    </div>
  );
}
