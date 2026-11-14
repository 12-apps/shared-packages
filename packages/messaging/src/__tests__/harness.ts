import { createMessagingEngine, type MessagingEngine } from "../core/engine";
import { createMemoryMessagingStore } from "../core/memory-store";
import type { MessagingHooks } from "../core/ports";
import type { MessagingStore } from "../core/store";
import { createApiMessaging } from "../server";
import { createWhatsAppAdapter, type FetchPort } from "../whatsapp";
import { APP_SECRET, NOW, PHONE_NUMBER_ID, VERIFY_TOKEN, WABA_ID, sign } from "./fixtures";

/**
 * One engine over an in-memory store (or a store the suite hands in), a
 * settable clock, a recording queue, a reversible fake seal, and the real
 * WhatsApp adapter whose Graph calls go to a scripted fetch.
 */

export const TENANT = "tenant-a";
export const OTHER_TENANT = "tenant-b";
export const TOKEN = "EAAG-business-token";

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function createHarness(
  options: {
    store?: MessagingStore;
    hooks?: MessagingHooks;
    answer?: (call: RecordedCall) => { status: number; body: unknown };
    retentionBatchSize?: number;
  } = {},
) {
  const memory = createMemoryMessagingStore();
  const store = options.store ?? memory;
  const clock = { current: NOW, now: () => clock.current };
  const queued: { name: string; payload: unknown }[] = [];
  const calls: RecordedCall[] = [];
  const answer = options.answer ?? (() => ({ status: 200, body: { messages: [{ id: `wamid.OUT-${calls.length}` }] } }));
  const fetch: FetchPort = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body ? (JSON.parse(init.body) as unknown) : null };
    calls.push(call);
    const { status, body } = answer(call);
    return { status, text: async () => JSON.stringify(body) };
  };
  const engine: MessagingEngine = createMessagingEngine({
    store,
    adapters: [
      createWhatsAppAdapter({
        appSecret: APP_SECRET,
        verifyToken: VERIFY_TOKEN,
        graph: { fetch, baseUrl: "https://graph.example.test", apiVersion: "v23.0" },
      }),
    ],
    secrets: { seal: (plain) => `sealed:${Buffer.from(plain).toString("base64")}`, open: (sealed) => Buffer.from(sealed.slice(7), "base64").toString() },
    enqueue: {
      enqueue: async (name, payload) => {
        queued.push({ name, payload });
        return { enqueued: true };
      },
    },
    clock,
    logger: silent,
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.retentionBatchSize ? { retentionBatchSize: options.retentionBatchSize } : {}),
  });
  const api = createApiMessaging({ engine, logger: silent });
  const route = (method: string) => api.routes.find((candidate) => candidate.method === method)!;

  /** POST a raw body to the webhook, signed unless told otherwise. */
  async function post(rawBody: string, signature: string | null = sign(rawBody), channel = "whatsapp") {
    const headers = new Headers({ "content-type": "application/json" });
    if (signature !== null) headers.set("x-hub-signature-256", signature);
    const request = new Request("https://host.test/api/webhooks/messaging/whatsapp", { method: "POST", headers, body: rawBody });
    return route("POST").handle({ actor: null, params: { channel }, query: {}, request }) as Promise<{ status: number; body: unknown }>;
  }

  /** Run every queued processing job, as a worker would. */
  async function drain() {
    const jobs = queued.splice(0);
    const outcomes = [];
    for (const job of jobs) outcomes.push(await engine.processDelivery((job.payload as { deliveryId: string }).deliveryId));
    return outcomes;
  }

  /** POST, then process: the whole pipeline. */
  async function deliver(rawBody: string) {
    const response = await post(rawBody);
    const outcomes = await drain();
    return { response, outcomes };
  }

  const connect = (tenantId = TENANT, phoneNumberId = PHONE_NUMBER_ID) =>
    engine.connect({
      tenantId,
      channel: "whatsapp",
      externalAccountId: phoneNumberId,
      externalParentId: WABA_ID,
      displayAddress: "+55 11 3000-0000",
      credential: TOKEN,
    });

  /** The memory store's rows (only meaningful when no store was handed in). */
  const dump = () => memory.dump();

  return { engine, store, dump, clock, queued, calls, api, route, post, drain, deliver, connect };
}

export type Harness = ReturnType<typeof createHarness>;
