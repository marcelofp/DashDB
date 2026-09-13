import { describe, expect, it } from "vitest";
import { coreActivity, sessionIntensity } from "./activity";

describe("representação de atividade", () => {
  it("mantém consultas longas visíveis mesmo sem conclusões no intervalo", () => {
    expect(coreActivity(0, 12)).toBeGreaterThan(0);
    expect(sessionIntensity(1)).toBeGreaterThan(0);
    expect(sessionIntensity(12)).toBeGreaterThan(sessionIntensity(1));
    expect(sessionIntensity(10000)).toBeLessThanOrEqual(1);
  });
  it("não cria atividade em repouso ou sem dados", () => {
    expect(coreActivity(0, 0)).toBe(0);
    expect(coreActivity(null, null)).toBe(0);
    expect(sessionIntensity(0)).toBe(0);
    expect(sessionIntensity(null)).toBe(0);
  });
});
