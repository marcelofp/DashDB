import { describe, expect, it, vi, afterEach } from "vitest";
import {
  emptyLiveSample,
  isLiveSample,
  LiveDataSource,
} from "./LiveDataSource";
import { trend } from "./simulation";

class FakeEvents {
  static instances: FakeEvents[] = [];
  url: string;
  handler?: (event: { data: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    FakeEvents.instances.push(this);
  }
  addEventListener(_type: string, handler: FakeEvents["handler"]) {
    this.handler = handler;
  }
  send(value: unknown) {
    this.handler?.({ data: JSON.stringify(value) });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeEvents.instances = [];
});
describe("real telemetry", () => {
  it("starts empty and rejects simulated or malformed metrics", () => {
    const sample = emptyLiveSample();
    expect(sample.history).toEqual([]);
    expect(isLiveSample(sample)).toBe(true);
    expect(isLiveSample({ ...sample, source: "simulated" })).toBe(false);
    expect(isLiveSample({ ...sample, metrics: {} })).toBe(false);
    expect(trend([], "connections", 1)).toBeNull();
  });
  it("shares a stream, nulls failed telemetry and closes after the last subscriber", () => {
    vi.stubGlobal("EventSource", FakeEvents);
    const source = new LiveDataSource("/api", "huawei");
    const off1 = source.subscribe(vi.fn()),
      off2 = source.subscribe(vi.fn());
    expect(FakeEvents.instances).toHaveLength(1);
    const event = FakeEvents.instances[0];
    const sample = {
      ...emptyLiveSample(),
      collector: "available",
      database: "online",
      health: "healthy",
      lastGoodAt: Date.now(),
    };
    event.send(sample);
    expect(source.getSnapshot().collector).toBe("available");
    event.onerror?.();
    expect(source.getSnapshot().database).toBe("unknown");
    expect(source.getSnapshot().lastGoodAt).toBe(sample.lastGoodAt);
    off1();
    expect(event.close).not.toHaveBeenCalled();
    off2();
    expect(event.close).toHaveBeenCalledOnce();
  });
  it("refuses old green snapshots even if transport is active", () => {
    vi.stubGlobal("EventSource", FakeEvents);
    const source = new LiveDataSource("/api", "huawei");
    const off = source.subscribe(vi.fn());
    FakeEvents.instances[0].send({
      ...emptyLiveSample(),
      collector: "available",
      collectedAt: Date.now() - 60000,
    });
    expect(source.getSnapshot().collector).toBe("unavailable");
    off();
  });
  it("switches streams and rejects samples from the previous Db2", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { href: "http://localhost/?source=live" },
      history: { replaceState },
    });
    vi.stubGlobal("EventSource", FakeEvents);
    const source = new LiveDataSource("/api", "huawei");
    const listener = vi.fn();
    const off = source.subscribe(listener);
    const huawei = FakeEvents.instances[0];
    expect(huawei.url).toBe("/api/events?source=huawei");

    source.setSource("cirion");
    expect(huawei.close).toHaveBeenCalledOnce();
    expect(source.getSnapshot().metadata?.sourceId).toBe("cirion");
    expect(source.getSnapshot().collector).toBe("unavailable");
    expect(FakeEvents.instances[1].url).toBe("/api/events?source=cirion");
    expect(replaceState).toHaveBeenCalledOnce();

    FakeEvents.instances[1].send({
      ...emptyLiveSample("huawei"),
      collector: "available",
      database: "online",
    });
    expect(source.getSnapshot().collector).toBe("unavailable");

    FakeEvents.instances[1].send({
      ...emptyLiveSample("cirion"),
      collector: "available",
      database: "online",
      health: "healthy",
      lastGoodAt: Date.now(),
    });
    expect(source.getSnapshot().collector).toBe("available");
    expect(source.getSnapshot().metadata?.sourceId).toBe("cirion");
    expect(source.getSnapshot().metadata?.location).toBe("Cirion");
    off();
  });
});
