import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
const headed = process.env.HEADED === "1";
const browser = await chromium.launch({ headless: !headed });
const reports = [];
for (const [width, height] of [
  [1920, 1080],
  [3840, 2160],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173/?seed=42&profile=1");
  await page.waitForSelector('canvas[data-scene-ready="true"]');
  await page.waitForTimeout(2000);
  for (const quality of ["high", "eco"]) {
    if (quality === "eco") {
      await page
        .getByRole("button", { name: "Configurar demonstração" })
        .click();
      await page.getByLabel("Qualidade gráfica").selectOption("eco");
      await page.getByRole("button", { name: "Fechar configurações" }).click();
      await page.waitForTimeout(1000);
    }
    await page.evaluate(() => (window.__db2Frames = []));
    await page.waitForTimeout(8000);
    const result = await page.evaluate(() => {
      const frames = window.__db2Frames ?? [],
        intervals = frames
          .slice(1)
          .map((v, i) => v - frames[i])
          .sort((a, b) => a - b);
      const canvas = document.querySelector("canvas"),
        gl = canvas?.getContext("webgl2"),
        debug = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        frames: frames.length,
        fps:
          Math.round(
            ((frames.length - 1) / (frames.at(-1) - frames[0])) * 100000,
          ) / 100,
        p95FrameIntervalMs:
          Math.round(intervals[Math.floor(intervals.length * 0.95)] * 100) /
          100,
        renderer: debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : "unavailable",
        particles: document.querySelectorAll("[data-particle]").length,
        canvasPixels: canvas ? [canvas.width, canvas.height] : null,
      };
    });
    reports.push({ width, height, quality, ...result, errors });
  }
  await page.close();
}
await mkdir("evidence", { recursive: true });
await writeFile(
  headed ? "evidence/performance-gpu.json" : "evidence/performance.json",
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      browser: browser.version(),
      method: `R3F useFrame timestamps, 8 seconds, Chromium ${headed ? "headed" : "headless"}, DPR 1; measures frame scheduling, not physical display scanout`,
      reports,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(reports, null, 2));
await browser.close();
