import { describe, expect, it, vi } from "vitest";
import {
  createSample,
  flowIntensity,
  particleCounts,
  periodHistory,
  sharesOf,
} from "./simulation";
import { MockDataSource } from "./MockDataSource";
import type { Scenario } from "../config";

const options = {
  seed: 42,
  time: Date.parse("2026-09-12T17:37:22Z"),
  step: 0,
  scenario: "normal" as Scenario,
  environment: "production" as const,
};
describe("motor determinístico e coerência", () => {
  it("reproduz exatamente a amostra inicial e distingue usuários, conexões e sessões", () => {
    const s = createSample(options);
    expect(s).toEqual(createSample(options));
    expect(s.metrics.sql.value).toBe(8000);
    expect(s.metrics.connections.value).toBe(342);
    expect(s.metrics.users.value).toBe(278);
    expect(s.metrics.executingSessions.value).toBe(92);
    expect(s.metrics.cpu.value).toBe(38);
    expect(s.metrics.memory.value).toBe(67);
    expect(s.metrics.response.value).toBe(42);
    expect(s.metrics.iops.value).toBe(12400);
    expect(s.metrics.cache.value).toBe(98.7);
  });
  it.each(["normal", "erp", "slow", "idle", "unavailable"] as Scenario[])(
    "%s mantém totais, histórico e qualidade consistentes",
    (scenario) => {
      for (let step = 0; step < 35; step++) {
        const s = createSample({ ...options, scenario, step });
        if (scenario === "unavailable") {
          expect(
            Object.values(s.metrics).every(
              (m) => m.value === null && m.quality === "unavailable",
            ),
          ).toBe(true);
          continue;
        }
        expect(
          s.applications.reduce(
            (sum, a) => sum + a.sqlExecutionsPerSecond.value!,
            0,
          ),
        ).toBe(s.metrics.sql.value);
        expect(
          s.applications.reduce((sum, a) => sum + a.sharePercent!, 0),
        ).toBe(scenario === "idle" ? 0 : 100);
        expect(s.sessionGroups.reduce((sum, a) => sum + a.executing!, 0)).toBe(
          s.metrics.executingSessions.value,
        );
        expect(s.history.at(-1)?.sql).toBe(s.metrics.sql.value);
        expect(s.metrics.executingSessions.value!).toBeLessThanOrEqual(
          s.metrics.connections.value!,
        );
        expect(s.metrics.users.value!).toBeLessThanOrEqual(
          s.metrics.connections.value!,
        );
      }
    },
  );
  it("arredonda participações em 100% sem dividir por zero", () => {
    expect(sharesOf([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
  });
  it("aumenta ERP, fluxo, total e alerta juntos", () => {
    const normal = createSample(options),
      peak = createSample({ ...options, scenario: "erp" });
    expect(peak.metrics.sql.value!).toBeGreaterThan(normal.metrics.sql.value!);
    expect(
      flowIntensity(peak.applications[0].sqlExecutionsPerSecond.value),
    ).toBeGreaterThan(
      flowIntensity(normal.applications[0].sqlExecutionsPerSecond.value),
    );
    expect(peak.alerts[0].id).toBe("erp");
    expect(peak.health).toBe("healthy");
  });
  it("coleta indisponível não representa zeros nem banco offline", () => {
    const normal = createSample(options),
      s = createSample({
        ...options,
        time: options.time + 2000,
        scenario: "unavailable",
        previous: normal,
      });
    expect(s.database).toBe("unknown");
    expect(s.metrics.sql.value).toBeNull();
    expect(s.lastGoodAt).toBe(normal.collectedAt);
    expect(s.history.at(-1)?.sql).toBeNull();
    expect(s.alerts[0].id).toBe("collector");
  });
  it("zero atividade mantém conexões abertas e nenhuma partícula", () => {
    const s = createSample({ ...options, scenario: "idle" });
    expect(s.metrics.connections.value).toBeGreaterThan(0);
    expect(s.metrics.executingSessions.value).toBe(0);
    expect(s.metrics.response.value).toBeNull();
    expect(s.metrics.response.quality).toBe("not-applicable");
    expect(
      particleCounts(s.applications.map((a) => a.sqlExecutionsPerSecond.value)),
    ).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
  it("intensidade é monotônica absoluta, limitada e não depende de outras aplicações", () => {
    const values = [null, 0, 1, 100, 500, 2720, 6500, 999999].map(
      flowIntensity,
    );
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    values
      .slice(1)
      .forEach((v, i) => expect(v).toBeGreaterThanOrEqual(values[i]));
    expect(
      particleCounts(Array(7).fill(99999)).reduce((a, b) => a + b, 0),
    ).toBeLessThanOrEqual(56);
    expect(
      particleCounts(Array(7).fill(99999), true).reduce((a, b) => a + b, 0),
    ).toBeLessThanOrEqual(28);
  });
  it("ambiente e filtros alteram os dados mantendo última amostra", () => {
    const s = createSample(options),
      h = createSample({ ...options, environment: "staging" });
    expect(h.metrics.sql.value).toBe(2800);
    expect(periodHistory(s.history, 1)[0].time).toBeGreaterThan(
      periodHistory(s.history, 24)[0].time,
    );
    expect(periodHistory(s.history, 6).at(-1)?.sql).toBe(8000);
  });
  it("lentidão produz alerta e piora do tempo SQL", () => {
    const s = createSample({ ...options, scenario: "slow" });
    expect(s.metrics.response.value!).toBeGreaterThan(150);
    expect(s.health).toBe("attention");
    expect(s.alerts[0].severity).toBe("critical");
  });
});
describe("assinaturas e ciclo de vida", () => {
  it("pausa, retoma e cancela timer ao encerrar a assinatura", () => {
    vi.useFakeTimers();
    const source = new MockDataSource(42, () => options.time);
    const fn = vi.fn();
    const unsubscribe = source.subscribe(fn);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
    source.setPaused(true);
    vi.advanceTimersByTime(4000);
    expect(fn).toHaveBeenCalledTimes(1);
    source.setPaused(false);
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    source.dispose();
    vi.useRealTimers();
  });
});
