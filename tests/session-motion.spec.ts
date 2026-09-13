import { test, expect } from "@playwright/test";
import { emptyLiveSample } from "../src/data/LiveDataSource";

test("sessões longas animam com SQL/s zero; pausa, repouso e falha interrompem o movimento", async ({ page }) => {
  // Control the transport boundary to reproduce a long-running query deterministically.
  await page.addInitScript(() => {
    class TestStream extends EventTarget {
      onerror: (() => void) | null = null;
      constructor() {
        super();
        (window as unknown as { testStream: TestStream }).testStream = this;
      }
      close() {}
    }
    window.EventSource = TestStream as unknown as typeof EventSource;
  });
  await page.goto("/?source=live&webgl=0");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForFunction(() => !!(window as unknown as { testStream: EventTarget }).testStream);
  const sample = emptyLiveSample("cirion");
  sample.collector = "available";
  sample.database = "online";
  sample.health = "healthy";
  sample.metrics.sql.value = 0;
  sample.metrics.executingSessions.value = 12;
  sample.sessionGroups = [
    { id: "long-query", label: "CONSULTA LONGA", executing: 12 },
    { id: "idle", label: "OCIOSO", executing: 0 },
  ];
  const send = () => page.evaluate((data) => {
    data.collectedAt = data.lastGoodAt = Date.now();
    (window as unknown as { testStream: EventTarget }).testStream.dispatchEvent(new MessageEvent("snapshot", { data: JSON.stringify(data) }));
  }, sample);
  await send();
  const flow = page.locator('[data-session-flow="long-query"]');
  const active = page.locator('[data-session-row="long-query"]');
  await expect(active).toContainText("12");
  await expect(active).toContainText("Executando");
  await expect(active.locator("[data-session-motion]")).toBeVisible();
  await expect(page.locator('[data-session-row="idle"] [data-session-motion]')).toHaveCount(0);
  await expect(flow).toHaveAttribute("data-particles", "4");
  await expect(page.locator('[data-session-flow="idle"]')).toHaveAttribute("data-particles", "0");
  await expect(page.getByText("EM REPOUSO", { exact: true })).toHaveCount(0);
  const movingDot = flow.locator("[data-particle] circle").first();
  const matrix = () => movingDot.evaluate(n => {
    const m = (n as SVGGraphicsElement).getCTM()!;
    return [m.e, m.f];
  });
  const before = await matrix();
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-moving", "true");
  await expect.poll(matrix, { timeout: 10000 }).not.toEqual(before);
  await page.getByRole("button", { name: "Pausar movimento" }).click();
  const paused = await matrix();
  await page.waitForTimeout(220);
  expect(await matrix()).toEqual(paused);
  expect(await active.locator("[data-session-motion] i").first().evaluate(n => getComputedStyle(n).animationPlayState)).toBe("paused");
  await page.getByRole("button", { name: "Retomar movimento" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByTestId("dashboard")).toHaveAttribute("data-moving", "false");
  const reduced = await matrix();
  await page.waitForTimeout(220);
  expect(await matrix()).toEqual(reduced);
  sample.metrics.executingSessions.value = 0;
  sample.sessionGroups[0].executing = 0;
  await send();
  await expect(page.locator("[data-session-motion], [data-particle]")).toHaveCount(0);
  await expect(page.getByText("EM REPOUSO", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { testStream: { onerror: () => void } }).testStream.onerror());
  await expect(page.getByText("NÃO CONFIRMADO", { exact: true })).toBeVisible();
  await expect(page.locator("[data-session-motion], [data-particle]")).toHaveCount(0);
});
