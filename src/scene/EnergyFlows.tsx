import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { demoConfig, runtime, type Quality } from "../config";
import { flowIntensities, particleCounts } from "../data/simulation";
import type { AppActivity, SessionGroup } from "../data/contracts";
import { sessionIntensity } from "./activity";
import s from "../styles/Dashboard.module.css";

type Layout = { width: number; height: number; paths: string[]; sessionPaths: string[] };
export default function EnergyFlows({
  board,
  apps,
  sessions,
  selected,
  quality,
  moving,
}: {
  board: RefObject<HTMLDivElement | null>;
  apps: AppActivity[];
  sessions: SessionGroup[];
  selected: string | null;
  quality: Quality;
  moving: boolean;
}) {
  const [layout, setLayout] = useState<Layout>({
    width: 1,
    height: 1,
    paths: [],
    sessionPaths: [],
  });
  const svg = useRef<SVGSVGElement>(null);
  const appIds = apps.map((a) => a.id).join(",");
  const sessionIds = sessions.map((a) => a.id).join(",");
  useEffect(() => {
    const root = board.current;
    if (!root) return;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const rect = root.getBoundingClientRect(),
        target = root
          .querySelector("[data-core-target]")
          ?.getBoundingClientRect();
      if (!target) return;
      const endX = target.left - rect.left,
        centerY = target.top - rect.top;
      const paths = appIds
        .split(",")
        .filter(Boolean)
        .map((id, i) => {
          const origin = root
            .querySelector(`[data-origin="${id}"]`)
            ?.getBoundingClientRect();
          if (!origin) return "";
          const x = origin.left + origin.width / 2 - rect.left,
            y = origin.top + origin.height / 2 - rect.top;
          const endY = centerY + ((i - 3) * 12 * rect.width) / 1864;
          const gap = endX - x;
          return `M ${x} ${y} C ${x + gap * 0.42} ${y}, ${endX - gap * 0.48} ${endY + (i - 3) * 9}, ${endX} ${endY}`;
        });
      const sessionTarget = root.querySelector("[data-session-target]")?.getBoundingClientRect();
      const ids = sessionIds.split(",").filter(Boolean);
      const sessionPaths = ids.map((id, i) => {
        const origin = root.querySelector(`[data-session-origin="${id}"]`)?.getBoundingClientRect();
        if (!origin || !sessionTarget) return "";
        const x = origin.left + origin.width / 2 - rect.left;
        const y = origin.top + origin.height / 2 - rect.top;
        const end = sessionTarget.left - rect.left;
        const endY = sessionTarget.top - rect.top + (i - (ids.length - 1) / 2) * 12 * rect.width / 1864;
        const gap = x - end;
        return `M ${x} ${y} C ${x - gap * 0.46} ${y}, ${end + gap * 0.36} ${endY}, ${end} ${endY}`;
      });
      setLayout({ width: rect.width, height: rect.height, paths, sessionPaths });
    };
    const schedule = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root
      .querySelectorAll("[data-origin], [data-core-target], [data-session-origin], [data-session-target]")
      .forEach((node) => observer.observe(node));
    document.fonts.ready.then(schedule);
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
    };
  }, [board, appIds, sessionIds]);
  useLayoutEffect(() => {
    if (moving) svg.current?.unpauseAnimations();
    else svg.current?.pauseAnimations();
  }, [moving, layout]);
  const pixelScale = Math.max(0.82, layout.width / 1864);
  const baseCounts = particleCounts(
    apps.map((a) => a.sqlExecutionsPerSecond.value),
    quality === "eco",
  );
  const counts = runtime.tv
    ? baseCounts.map((count) => count > 0 ? Math.max(1, Math.ceil(count / 2)) : 0)
    : baseCounts;
  const appRates = apps.map((app) => app.sqlExecutionsPerSecond.value);
  const appIntensities = flowIntensities(appRates);
  const peakRate = Math.max(0, ...appRates.map((rate) => rate ?? 0));
  // Session streams describe concurrent activity, not completed query events.
  const streams = [
    ...apps.map((app, i) => ({
      id: app.id, channel: "sql", intensity: appIntensities[i],
      dominant:
        app.sqlExecutionsPerSecond.value !== null &&
        app.sqlExecutionsPerSecond.value > 0 &&
        app.sqlExecutionsPerSecond.value === peakRate,
      count: counts[i], path: layout.paths[i], duration: demoConfig.flow.durationSeconds,
    })),
    ...sessions.map((group, i) => {
      const intensity = sessionIntensity(group.executing);
      return {
        id: group.id, channel: "session", intensity,
        dominant: false,
        count: intensity > 0
          ? Math.ceil(intensity * (runtime.tv ? 2 : quality === "eco" ? 3 : 5))
          : 0,
        path: layout.sessionPaths[i], duration: 3.8 - intensity * 1.2,
      };
    }),
  ];
  return (
    <svg
      ref={svg}
      className={s.flows}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
      data-testid="energy-flows"
    >
      <defs>
        <filter id="flow-glow" x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation={3 * pixelScale} />
        </filter>
      </defs>
      {streams.map((stream) => {
        const { intensity, count, path, duration: baseDuration, id, channel, dominant } = stream;
        const duration = runtime.tv ? baseDuration * 0.82 : baseDuration;
        const session = channel === "session";
        const color = session ? "#25dbff" :
            dominant
              ? "#d946ef"
              : intensity > 0.2
                ? "#7c3aff"
                : "#7360ff";
        const visible = intensity > 0 ? 0.28 + intensity * 0.72 : 0;
        const width =
          (demoConfig.flow.minWidth +
            visible * (demoConfig.flow.maxWidth - demoConfig.flow.minWidth)) *
          pixelScale;
        if (!path) return null;
        const pathId = `flow-${channel}-${id}`;
        return (
          <g
            key={pathId}
            data-flow={session ? undefined : id}
            data-session-flow={session ? id : undefined}
            data-intensity={intensity}
            data-particles={count}
            opacity={!session && selected && selected !== id ? 0.22 : 1}
            className={s.flowGroup}
          >
            <path
              id={pathId}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={width}
              opacity={intensity > 0 ? 0.55 + intensity * 0.35 : 0.12}
            />
            {intensity > 0 && (
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={width * 4}
                opacity={0.22 + intensity * 0.42}
                filter={quality === "high" ? "url(#flow-glow)" : undefined}
              />
            )}
            {Array.from({ length: count }, (_, j) => (
              <g key={j} data-particle="true">
                {!runtime.tv && (
                  <circle
                    r={(3 + intensity * 2.5) * pixelScale}
                    fill={color}
                    filter={quality === "high" ? "url(#flow-glow)" : undefined}
                  >
                    <animateMotion
                      dur={`${duration}s`}
                      begin={`${(-j / count) * duration}s`}
                      repeatCount="indefinite"
                      calcMode="paced"
                    >
                      <mpath href={`#${pathId}`} />
                    </animateMotion>
                  </circle>
                )}
                <path
                  d={`M${-22 * pixelScale} 0 H0 M${-8 * pixelScale} ${-3 * pixelScale} L0 0 L${-8 * pixelScale} ${3 * pixelScale}`}
                  stroke={intensity > 0.3 ? "#f8caff" : "#8feaff"}
                  strokeWidth={1.8 * pixelScale}
                  fill="none"
                >
                  <animateMotion
                    dur={`${duration}s`}
                    begin={`${(-j / count) * duration}s`}
                    repeatCount="indefinite"
                    calcMode="paced"
                    rotate="auto"
                  >
                    <mpath href={`#${pathId}`} />
                  </animateMotion>
                </path>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
