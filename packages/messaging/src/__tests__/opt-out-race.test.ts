import { describe, expect, it, vi } from "vitest";

import { createMemoryMessagingStore } from "../core/memory-store";
import { createPrismaMessagingStore } from "../core/prisma-store";
import type { MessagingStore } from "../core/store";
import { NOW, textMessage, userPreferenceStop } from "./fixtures";
import { TENANT, createHarness } from "./harness";
import { migratedPglite, pgliteDb } from "./pglite-db";

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const STORES: [string, () => Promise<MessagingStore>][] = [
  ["memory", async () => createMemoryMessagingStore()],
  ["prisma on Postgres", async () => createPrismaMessagingStore(pgliteDb(await migratedPglite()))],
];

function racingFind(store: MessagingStore) {
  // The pending race lives in a queue the helper owns; the wrapper only shifts from it.
  const pending: (() => Promise<unknown>)[] = [];
  const wrapped = {
    ...store,
    findConversation: async (...args: Parameters<MessagingStore["findConversation"]>) => {
      const run = pending.shift();
      const result = await store.findConversation(...args);
      if (run) await run();
      return result;
    },
  } as MessagingStore;
  return { store: wrapped, nextCallRaces: (run: () => Promise<unknown>) => void pending.push(run) };
}

describe.each(STORES)("probe on %s", (_name, makeStore) => {
  it("a Meta stop signal sent AFTER a re-opening message survives that message's concurrent write", async () => {
    const onInboundMessage = vi.fn();
    const raced = racingFind(await makeStore());
    const h = createHarness({ store: raced.store, hooks: { onInboundMessage } });
    await h.connect();
    await h.deliver(textMessage("hello", { id: "wamid.0", at: at(-60_000) }));
    await h.deliver(textMessage("PARAR", { id: "wamid.stop", at: at(0) }));
    await h.post(textMessage("oi", { id: "wamid.oi", at: at(10_000) }));
    await h.post(userPreferenceStop(at(20_000)));
    const [oiJob, stopJob] = h.queuedIds();
    h.queued.splice(0);
    onInboundMessage.mockClear();

    // "oi" (T+10 s) reads OPTED_OUT/optedOutAt T; Meta's stop (T+20 s) lands in full; then "oi" writes.
    raced.nextCallRaces(() => h.engine.processDelivery(stopJob!));
    await h.engine.processDelivery(oiJob!);

    // Sequentially, in either order, the result is OPTED_OUT (stop is the latest act of the contact).
    expect(await h.store.findConversation(TENANT, "whatsapp", "5511987654321")).toMatchObject({ state: "OPTED_OUT", optedOutAt: at(20_000) });
  });
});
