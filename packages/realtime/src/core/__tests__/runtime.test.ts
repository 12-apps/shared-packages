import { afterEach, describe, expect, it, vi } from "vitest";

import { createInlineRealtimeDriver } from "../../drivers/inline";
import {
  configureRealtime,
  getRealtimeDriver,
  publishRealtimeEvent,
  resetRealtimeRuntime,
  subscribeRealtime,
} from "../runtime";
import { tenantTopic } from "../topics";

afterEach(() => {
  resetRealtimeRuntime();
});

describe("publishRealtimeEvent", () => {
  it("reports no-driver instead of throwing when nothing is configured", async () => {
    const result = await publishRealtimeEvent(tenantTopic("c1", "kitchen"), {
      type: "kitchen.ticket.updated",
      data: { ticketId: "t1" },
    });
    expect(result).toEqual({ published: false, reason: "no-driver" });
  });

  it("refuses a malformed topic without throwing", async () => {
    configureRealtime({ driver: createInlineRealtimeDriver() });
    const result = await publishRealtimeEvent("tenant::kitchen", {
      type: "kitchen.ticket.updated",
      data: {},
    });
    expect(result).toEqual({ published: false, reason: "invalid-topic" });
  });

  it("stamps ts and a unique id onto the envelope", async () => {
    const driver = createInlineRealtimeDriver();
    configureRealtime({ driver });
    await publishRealtimeEvent(tenantTopic("c1", "kitchen"), {
      type: "kitchen.ticket.updated",
      data: { ticketId: "t1" },
    });
    await publishRealtimeEvent(tenantTopic("c1", "kitchen"), {
      type: "kitchen.ticket.updated",
      data: { ticketId: "t2" },
    });

    const [first, second] = driver.published;
    expect(first?.event.ts).toBeTypeOf("number");
    expect(first?.event.id).toBeTypeOf("string");
    expect(first?.event.id).not.toBe(second?.event.id);
  });

  it("reports error (never throws) when the driver fails", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    configureRealtime({
      driver: {
        kind: "broken",
        publish: () => Promise.reject(new Error("redis down")),
        subscribe: () => Promise.reject(new Error("redis down")),
        close: () => Promise.resolve(),
      },
      logger,
    });

    const result = await publishRealtimeEvent(tenantTopic("c1", "kitchen"), {
      type: "kitchen.ticket.updated",
      data: {},
    });

    expect(result).toEqual({ published: false, reason: "error" });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeRealtime", () => {
  it("throws without a driver — a subscribe endpoint must answer 'off' explicitly", async () => {
    await expect(subscribeRealtime("tenant:c1:kitchen", vi.fn())).rejects.toThrow(
      /no driver/,
    );
  });

  it("round-trips an event through the configured driver", async () => {
    configureRealtime({ driver: createInlineRealtimeDriver() });
    const received: { types: string[] } = { types: [] };
    const unsubscribe = await subscribeRealtime(
      tenantTopic("c1", "kitchen"),
      (_topic, event) => {
        received.types.push(event.type);
      },
    );

    await publishRealtimeEvent(tenantTopic("c1", "kitchen"), {
      type: "kitchen.ticket.updated",
      data: { ticketId: "t1" },
    });
    await unsubscribe();
    await publishRealtimeEvent(tenantTopic("c1", "kitchen"), {
      type: "kitchen.ticket.updated",
      data: { ticketId: "t2" },
    });

    expect(received.types).toEqual(["kitchen.ticket.updated"]);
  });
});

describe("configureRealtime", () => {
  it("installs the driver for the process", () => {
    expect(getRealtimeDriver()).toBeNull();
    const driver = createInlineRealtimeDriver();
    configureRealtime({ driver });
    expect(getRealtimeDriver()).toBe(driver);
  });
});
