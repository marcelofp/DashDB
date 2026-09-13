import { test, expect, type Page } from "@playwright/test";
const frozen = "/?seed=42&time=2026-09-12T17:37:22Z&freeze=1";
async function load(page: Page, url = frozen) {
  await page.goto(url);
  await page.getByTestId("app-erp").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-flow="erp"]')).toBeAttached();
}
async function scenario(page: Page, value: string) {
  if (!(await page.getByLabel("Cenário", { exact: true }).isVisible()))
    await page.getByRole("button", { name: "Configurar demonstração" }).click();
  await page.getByLabel("Cenário", { exact: true }).selectOption(value);
}
test("composição Full HD e 4K: sem cortes, painéis sobrepostos ou rolagem", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize(size);
    await load(page);
    expect(
      await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
      })),
    ).toEqual({ w: size.width, h: size.height });
    const panels = await page.locator("section").evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return {
          title: n.querySelector("h2")?.textContent,
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          overflow: n.scrollHeight > n.clientHeight + 2,
        };
      }),
    );
    for (const p of panels) {
      expect(p.x, p.title).toBeGreaterThanOrEqual(0);
      expect(p.right, p.title).toBeLessThanOrEqual(size.width);
      expect(p.bottom, p.title).toBeLessThan(size.height);
      expect(p.overflow, p.title).toBe(false);
    }
    const origins = await page.locator("[data-flow]").evaluateAll((nodes) =>
      nodes.map((n) => {
        const path = n.querySelector("path")!;
        const point = path.getPointAtLength(0);
        const board = document.querySelector("main")!.getBoundingClientRect();
        const row = document
          .querySelector(`[data-origin="${n.getAttribute("data-flow")}"]`)!
          .getBoundingClientRect();
        return Math.hypot(
          board.left + point.x - row.left - row.width / 2,
          board.top + point.y - row.top - row.height / 2,
        );
      }),
    );
    origins.forEach((distance) => expect(distance).toBeLessThan(2));
  }
  expect(errors).toEqual([]);
});
test("pico ERP aumenta volume, espessura e partículas; seleção abre resumo", async ({
  page,
}) => {
  await load(page);
  const flow = page.locator('[data-flow="erp"]'),
    intensity = +(await flow.getAttribute("data-intensity"))!,
    particles = +(await flow.getAttribute("data-particles"))!;
  await expect(flow.locator("path").first()).toHaveAttribute("stroke", "#d946ef");
  expect(
    await page
      .getByTestId("app-erp")
      .locator('span[style*="background"]')
      .getAttribute("style"),
  ).toContain("var(--magenta)");
  expect(intensity).toBeGreaterThan(
    +(await page.locator('[data-flow="portal"]').getAttribute("data-intensity"))!,
  );
  await scenario(page, "erp");
  expect(+(await flow.getAttribute("data-intensity"))!).toBeGreaterThan(
    intensity,
  );
  expect(+(await flow.getAttribute("data-particles"))!).toBeGreaterThan(
    particles,
  );
  await page.getByRole("button", { name: "Fechar configurações" }).click();
  await page.getByTestId("app-erp").click();
  await expect(page.getByText("Fluxo agregado de execuções SQL")).toBeVisible();
  await expect(page.getByTestId("app-erp")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: "Fechar resumo da aplicação" })
    .click();
});
test("zero não é indisponível; coleta ausente não vira DB2 offline", async ({
  page,
}) => {
  await load(page);
  await scenario(page, "idle");
  await expect(page.getByTestId("total-sql")).toHaveText("0 SQL/s");
  await expect(page.locator("[data-particle]")).toHaveCount(0);
  await expect(page.getByText("EM REPOUSO", { exact: true })).toBeVisible();
  await expect(page.getByTestId("executing-sessions")).toHaveText("0");
  await scenario(page, "unavailable");
  await expect(page.getByTestId("total-sql")).toHaveText("— SQL/s");
  await expect(page.locator("[data-particle]")).toHaveCount(0);
  await expect(page.getByText("NÃO CONFIRMADO", { exact: true })).toBeVisible();
  await expect(page.getByText("OFFLINE", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("dashboard")).toHaveAttribute(
    "data-collector",
    "unavailable",
  );
});
test("lentidão, filtros de alertas, ambiente e período funcionam", async ({
  page,
}) => {
  await load(page);
  await scenario(page, "slow");
  expect(
    Number(
      await page
        .getByTestId("response")
        .innerText()
        .then((s) => s.replace("ms", "")),
    ),
  ).toBeGreaterThan(150);
  await page.getByRole("button", { name: "Fechar configurações" }).click();
  await page.getByLabel("Filtrar alertas").selectOption("critical");
  await expect(page.getByText("Tempo SQL acima de 150 ms")).toBeVisible();
  await expect(page.getByText("Backup de demonstração concluído")).toHaveCount(
    0,
  );
  await page.getByLabel("Ambiente de demonstração").selectOption("staging");
  await expect(page.getByTestId("total-sql")).toHaveText("2.800 SQL/s");
  const chart = page.getByRole("img").filter({ hasText: "" }).last();
  const before = await page
    .locator('[aria-label^="Execuções SQL por segundo"]')
    .getAttribute("aria-label");
  await page.getByLabel("Período dos gráficos").selectOption("1");
  const after = await page
    .locator('[aria-label^="Execuções SQL por segundo"]')
    .getAttribute("aria-label");
  expect(after).not.toBe(before);
  expect(await chart.count()).toBeGreaterThan(0);
});
test("pausa congela amostras e movimento; retomar volta a atualizar", async ({
  page,
}) => {
  await load(page, "/?seed=42");
  await page.getByRole("button", { name: "Pausar simulação" }).click();
  const id = await page.getByTestId("dashboard").getAttribute("data-sample");
  await page.waitForTimeout(2300);
  await expect(page.getByTestId("dashboard")).toHaveAttribute(
    "data-sample",
    id!,
  );
  await expect(page.getByTestId("dashboard")).toHaveAttribute(
    "data-moving",
    "false",
  );
  await page.getByRole("button", { name: "Retomar simulação" }).click();
  await expect(page.getByTestId("dashboard")).not.toHaveAttribute(
    "data-sample",
    id!,
    { timeout: 3500 },
  );
});
test("teclado, movimento reduzido e fallback SVG", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await load(page, "/?webgl=0");
  await expect(page.getByTestId("svg-fallback")).toBeVisible();
  await expect(page.getByTestId("dashboard")).toHaveAttribute(
    "data-moving",
    "false",
  );
  await page.getByRole("button", { name: "Configurar demonstração" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Cenário", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Configurar demonstração" }),
  ).toBeFocused();
});
test("tela cheia entra por ação e permite saída", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "Ativar modo telão" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await expect(
    page.getByText("DEMONSTRAÇÃO • DADOS SIMULADOS", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair da tela cheia" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
});
test("reorganiza em viewport menor e mobile sem rolagem horizontal", async ({
  page,
}) => {
  for (const size of [
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(frozen + "&webgl=0");
    await page.getByTestId("app-erp").waitFor();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(size.width);
    await expect(
      page.getByRole("heading", { name: "Consultas mais pesadas" }),
    ).toBeAttached();
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeGreaterThan(size.height);
  }
});
test("WebGL renderiza geometria e a cena efetivamente se movimenta", async ({
  page,
}) => {
  await load(page, "/?seed=42&profile=1");
  await expect(page.locator('canvas[data-scene-ready="true"]')).toBeVisible({
    timeout: 15000,
  });
  const canvas = page.locator("canvas"),
    before = await canvas.screenshot();
  await expect
    .poll(() => page.evaluate(() => window.__db2Frames?.length ?? 0))
    .toBeGreaterThan(10);
  await page.waitForTimeout(300);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole("button", { name: "Pausar simulação" }).click();
  await expect(page.getByTestId("dashboard")).toHaveAttribute(
    "data-moving",
    "false",
  );
  await page.waitForTimeout(150);
  const count = await page.evaluate(() => window.__db2Frames?.length ?? 0);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__db2Frames?.length ?? 0)).toBe(
    count,
  );
});
