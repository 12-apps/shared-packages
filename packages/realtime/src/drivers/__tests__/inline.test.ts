import { describe, expect, it, vi } from "vitest";

import type { RealtimeEvent } from "../../core/types";
import { createInlineRealtimeDriver } from "../inline";

const event = (type: string): RealtimeEvent => ({
  type,
  data: { id: "x" },
  ts: 1,
  id: "e1",
});

describe("inline realtime driver", () => {
  it("delivers a published event to every subscriber of the topic", async () => {
    const driver = createInlineRealtimeDriver();
    const seen: { events: Array<{ topic: string; type: string }> } = { events: [] };
    await driver.subscribe("tenant:c1:kitchen", (topic, evt) => {
      seen.events.push({ topic, type: evt.type });
    });
    await driver.subscribe("tenant:c1:kitchen", (topic, evt) => {
      seen.events.push({ topic, type: evt.type });
    });

    await driver.publish("tenant:c1:kitchen", event("kitchen.ticket.updated"));

    expect(seen.events).toEqual([
      { topic: "tenant:c1:kitchen", type: "kitchen.ticket.updated" },
      { topic: "tenant:c1:kitchen", type: "kitchen.ticket.updated" },
    ]);
  });

  it("does not deliver across topics", async () => {
    const driver = createInlineRealtimeDriver();
    const handler = vi.fn();
    await driver.subscribe("tenant:c1:kitchen", handler);

    await driver.publish("tenant:c2:kitchen", event("kitchen.ticket.updated"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", async () => {
    const driver = createInlineRealtimeDriver();
    const handler = vi.fn();
    const unsubscribe = await driver.subscribe("tenant:c1:orders", handler);
    await unsubscribe();

    await driver.publish("tenant:c1:orders", event("orders.updated"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("a throwing subscriber neither fails the publish nor starves its siblings", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const driver = createInlineRealtimeDriver({ logger });
    const survivor = vi.fn();
    await driver.subscribe("tenant:c1:kitchen", () => {
      throw new Error("boom");
    });
    await driver.subscribe("tenant:c1:kitchen", survivor);

    await expect(
      driver.publish("tenant:c1:kitchen", event("kitchen.ticket.updated")),
    ).resolves.toBeUndefined();

    expect(survivor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("records publishes with their delivery count, for assertions", async () => {
    const driver = createInlineRealtimeDriver();
    await driver.subscribe("tenant:c1:kitchen", vi.fn());

    await driver.publish("tenant:c1:kitchen", event("kitchen.ticket.updated"));
    await driver.publish("tenant:c1:tables", event("tables.updated"));

    expect(driver.published.map((r) => [r.topic, r.delivered])).toEqual([
      ["tenant:c1:kitchen", 1],
      ["tenant:c1:tables", 0],
    ]);
    driver.clearPublished();
    expect(driver.published).toHaveLength(0);
  });

  it("close() drops every subscription", async () => {
    const driver = createInlineRealtimeDriver();
    const handler = vi.fn();
    await driver.subscribe("tenant:c1:kitchen", handler);
    await driver.close();

    await driver.publish("tenant:c1:kitchen", event("kitchen.ticket.updated"));

    expect(handler).not.toHaveBeenCalled();
  });
});
