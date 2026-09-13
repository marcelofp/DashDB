import { demoConfig, type Environment, type Scenario } from "../config";
import type {
  DashboardDataSource,
  DashboardSample,
  DemoControls,
} from "./contracts";
import { createSample } from "./simulation";

export class MockDataSource implements DashboardDataSource, DemoControls {
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private sample: DashboardSample;
  private step = 0;
  private paused = false;
  private scenario: Scenario = "normal";
  private environment: Environment = "production";
  constructor(
    private seed = demoConfig.seed,
    private clock = () => Date.now(),
  ) {
    this.sample = createSample({
      seed,
      step: 0,
      time: clock(),
      scenario: this.scenario,
      environment: this.environment,
    });
  }
  getSnapshot = () => this.sample;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.timer)
      this.timer = setInterval(() => {
        if (!this.paused) this.tick();
      }, demoConfig.sampleIntervalMs);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  };
  tick = () => {
    this.sample = createSample({
      seed: this.seed,
      step: ++this.step,
      time: this.clock(),
      scenario: this.scenario,
      environment: this.environment,
      previous: this.sample,
    });
    this.listeners.forEach((listener) => listener());
  };
  setScenario = (scenario: Scenario) => {
    this.scenario = scenario;
    this.tick();
  };
  setEnvironment = (environment: Environment) => {
    this.environment = environment;
    this.step = 0;
    this.sample = createSample({
      seed: this.seed,
      step: 0,
      time: this.clock(),
      scenario: this.scenario,
      environment,
    });
    this.listeners.forEach((listener) => listener());
  };
  setPaused = (paused: boolean) => {
    this.paused = paused;
  };
  dispose = () => {
    clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  };
}
