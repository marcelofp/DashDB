import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint } from "../data/contracts";
import { number, timeLabel } from "./Primitives";
import s from "../styles/Dashboard.module.css";

export function AccessChart({ data }: { data: HistoryPoint[] }) {
  const id = useId().replace(/:/g, "");
  const [scale, setScale] = useState(1);
  const max = Math.max(0, ...data.map((p) => p.sql ?? 0));
  return (
    <div
      className={s.accessChart}
      role="img"
      aria-label={`Execuções SQL por segundo no período. Pico de ${number(max)} SQL/s. Última amostra: ${number(data.at(-1)?.sql ?? null)} SQL/s.`}
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={0}
        onResize={(width) => setScale(Math.max(0.82, Math.min(2, width / 512)))}
      >
        <AreaChart
          data={data}
          margin={{ top: 8 * scale, right: 8 * scale, left: 0, bottom: 0 }}
          accessibilityLayer={false}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d946ef" stopOpacity={0.65} />
              <stop offset="1" stopColor="#7c3aff" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="#19305a"
            vertical={true}
            strokeOpacity={0.65}
          />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            padding={{ left: 10 * scale, right: 22 * scale }}
            tickFormatter={timeLabel}
            tickLine={false}
            axisLine={false}
            height={25 * scale}
            tickMargin={8 * scale}
            minTickGap={28 * scale}
            tick={{ fill: "#a5b1d8" }}
            tickCount={5}
          />
          <YAxis
            domain={[0, "auto"]}
            tickFormatter={(v) =>
              v >= 1000 ? `${number(v / 1000, 1)}k` : number(v, v < 10 ? 1 : 0)
            }
            tickLine={false}
            axisLine={false}
            width={45 * scale}
            tick={{ fill: "#a5b1d8" }}
            tickCount={4}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className={s.tooltip}>
                  <strong>{timeLabel(Number(label))}</strong>
                  <span>{number(payload[0].value as number)} SQL/s</span>
                </div>
              ) : null
            }
          />
          <Area
            dataKey="sql"
            type="linear"
            stroke="#dc4cff"
            strokeWidth={2}
            fill={`url(#${id})`}
            isAnimationActive={false}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function Sparkline({
  data,
  metric,
  color,
  bars = false,
}: {
  data: HistoryPoint[];
  metric: "response" | "iops" | "cache";
  color: string;
  bars?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const points = data.slice(-30);
  return (
    <div className={s.sparkline} aria-hidden="true">
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={0}
      >
        {bars ? (
          <BarChart
            data={points}
            margin={{ top: 4, bottom: 0, left: 0, right: 0 }}
            accessibilityLayer={false}
          >
            <YAxis hide domain={metric === "cache" ? [0, 100] : [0, "auto"]} />
            <Bar dataKey={metric} fill={color} isAnimationActive={false} />
          </BarChart>
        ) : (
          <AreaChart
            data={points}
            margin={{ top: 8, bottom: 0, left: 0, right: 0 }}
            accessibilityLayer={false}
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop stopColor={color} stopOpacity={0.25} />
                <stop offset="1" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              dataKey={metric}
              type="linear"
              stroke={color}
              fill={`url(#${id})`}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
