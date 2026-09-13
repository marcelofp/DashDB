import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
await mkdir("evidence", { recursive: true });
const url = process.env.DASHBOARD_URL ?? "http://127.0.0.1:5173";
const reports = [];
for (const [name, width, height] of [
  ["full-hd", 1920, 1080],
  ["4k", 3840, 2160],
  ["compact", 1024, 768],
  ["mobile", 390, 844],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${url}/?seed=42&time=2026-09-12T17:37:22Z&freeze=1`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector(
    '[data-renderer="webgl"] canvas[data-scene-ready="true"], [data-renderer="svg"] [data-testid="svg-fallback"]',
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: `evidence/${name}.png`, fullPage: true });
  reports.push({
    name,
    width,
    height,
    errors,
    layout: await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      renderer: document
        .querySelector("[data-renderer]")
        ?.getAttribute("data-renderer"),
    })),
  });
  await page.close();
}
for (const scenario of ["erp", "unavailable", "fallback"]) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${url}/?seed=42&time=2026-09-12T17:37:22Z&freeze=1${scenario === "fallback" ? "&webgl=0" : ""}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('[data-renderer="webgl"] canvas[data-scene-ready="true"], [data-renderer="svg"] [data-testid="svg-fallback"]');
  if (scenario !== "fallback") {
    await page.getByRole("button", { name: "Configurar demonstração" }).click();
    await page.getByLabel("Cenário", { exact: true }).selectOption(scenario);
    await page.getByRole("button", { name: "Fechar configurações" }).click();
    await page.waitForTimeout(1700);
  }
  await page.screenshot({ path: `evidence/${scenario}.png`, fullPage: true });
  await page.close();
}
await writeFile("evidence/captures.json", JSON.stringify(reports, null, 2));
await browser.close();
console.log(JSON.stringify(reports, null, 2));
