import { describe, expect, it } from "vitest";

import type { MarketplaceAdapter } from "../core/adapter";
import type { MarketplaceDb } from "../core/ports";
import { AvailabilityRetryError } from "../core/pause-job";
import type { MarketplaceAvailability, StorePauseRef, StorePauseRequest } from "../core/pause-port";
import { MARKETPLACE_AVAILABILITY_JOB, type AvailabilityJobPayload } from "../core/pause-store";
import { createIfoodAdapter } from "../ifood";
import { IFOOD_ADAPTER_COPY_EN_US } from "../ifood/en-US";
import { createMemoryDb } from "./memory-db";
import { TENANT, createHarness, type Harness } from "./harness";

/**
 * The store pause (FUT-4851) through FAKE marketplaces, the second-adapter
 * pattern: the engine is driven exactly as it ships, and a marketplace is a
 * map of closures the test can read. The owner's rules, as assertions:
 * the end is the kitchen's estimate and is renewed; the engine deletes only
 * what it created; the last ask wins; a lost answer makes no second closure;
 * nothing stays closed past the kitchen's pause.
 */

const ACME = "ACME_EATS";
const SWITCHY = "SWITCHY";
const NOPAUSE = "NOPAUSE";
const NOW = new Date("2026-11-11T12:00:00.000Z");
const minutes = (n: number): Date => new Date(NOW.getTime() + n * 60_000);

type Script = "retry" | "refused" | "lost";

/** A marketplace that holds closures by id, with scripted failures. */
function interruptionMarketplace() {
  const closures = new Map<string, { until: Date; byHand: boolean }>();
  const calls: string[] = [];
  const script: Script[] = [];
  /** One-shot hooks run while a call is in flight: the race's other ask. */
  const during = { pause: [] as (() => Promise<void>)[], resume: [] as (() => Promise<void>)[] };
  const availability: MarketplaceAvailability = {
    kind: "interruption",
    pause: async (_ctx, request: StorePauseRequest) => {
      calls.push(`pause:${request.until.toISOString()}`);
      const next = script.shift();
      if (next === "retry") return { kind: "retry", reason: "status 503" };
      if (next === "refused") return { kind: "refused", status: 409, message: "Loja fechada pelo parceiro" };
      if (!closures.has(request.key)) closures.set(request.key, { until: request.until, byHand: false });
      await during.pause.shift()?.();
      if (next === "lost") return { kind: "retry", reason: "timeout" };
      return { kind: "paused", externalId: request.key, until: request.until };
    },
    resume: async (_ctx, ref: StorePauseRef) => {
      calls.push(`resume:${ref.externalId ?? `key=${ref.key}`}`);
      const next = script.shift();
      if (next === "retry") return { kind: "retry", reason: "status 503" };
      if (next === "refused") return { kind: "refused", status: 400, message: "Interrupção inválida" };
      await during.resume.shift()?.();
      const id = ref.externalId ?? (ref.key !== null && closures.has(ref.key) ? ref.key : null);
      if (id !== null) closures.delete(id);
      return { kind: "accepted" };
    },
  };
  return {
    availability,
    closures,
    calls,
    script,
    during,
  };
}

/** A store-wide switch: on or off, no id. */
function switchMarketplace() {
  const state = { enabled: true };
  const calls: string[] = [];
  const script: Script[] = [];
  const availability: MarketplaceAvailability = {
    kind: "switch",
    pause: async (_ctx, request) => {
      calls.push("off");
      if (script.shift() === "refused") return { kind: "refused", status: 403, message: "not allowed" };
      state.enabled = false;
      return { kind: "paused", externalId: null, until: request.until };
    },
    resume: async () => {
      calls.push("on");
      state.enabled = true;
      return { kind: "accepted" };
    },
  };
  return { availability, state, calls, script };
}

function adapter(provider: string, availability?: MarketplaceAvailability): MarketplaceAdapter {
  return {
    provider,
    capabilities: {
      apiConfirm: false,
      apiCancel: false,
      cancelAfterAccept: false,
      asyncCancellationOutcome: false,
      perOrderAppLink: false,
      confirmTakesPreparationTime: false,
    },
    normalize: () => null,
    readSignature: () => null,
    verifySignature: () => false,
    cancellationReasons: () => [{ code: "X", label: "X", itemUnavailable: false, needsItems: false }],
    confirm: async () => ({ kind: "accepted" }),
    requestCancellation: async () => ({ kind: "accepted" }),
    appLink: () => "https://partners.example.test/",
    ...(availability ? { availability } : {}),
  };
}

function setup(options: { queueDown?: boolean } = {}) {
  const acme = interruptionMarketplace();
  const switchy = switchMarketplace();
  const h = createHarness({
    adapters: [
      createIfoodAdapter({ copy: IFOOD_ADAPTER_COPY_EN_US }),
      adapter(ACME, acme.availability),
      adapter(SWITCHY, switchy.availability),
      adapter(NOPAUSE),
    ],
    ...(options.queueDown ? { queueDown: true } : {}),
  });
  return { h, acme, switchy };
}

/** The availability jobs queued since the last call, consumed. */
function takeJobs(h: Harness, seen: { count: number }): AvailabilityJobPayload[] {
  const jobs = h.enqueued.filter((job) => job.name === MARKETPLACE_AVAILABILITY_JOB);
  const fresh = jobs.slice(seen.count).map((job) => job.payload as unknown as AvailabilityJobPayload);
  seen.count = jobs.length;
  return fresh;
}

/** Run every queued availability job once, as the runner's first attempt would. */
async function drain(h: Harness, seen: { count: number }, attempt = { attempt: 1, maxAttempts: 3 }) {
  const outcomes = [];
  for (const payload of takeJobs(h, seen)) outcomes.push(await h.engine.runAvailability(payload, attempt));
  return outcomes;
}

const pauseRow = (h: Harness, provider = ACME) =>
  h.memory.tables.marketplaceStorePause.rows.find((row) => row.provider === provider) as Record<string, unknown> | undefined;

const pause = (h: Harness, until: Date) =>
  h.engine.pauseStore({ clientId: TENANT, until, reason: "Cozinha cheia", timeZone: "America/Sao_Paulo", now: NOW });

describe("pauseStore: the host's ask, fanned out", () => {
  it("refuses an end that is not in the future, and records nothing", async () => {
    const { h } = setup();
    // eslint-disable-next-line test-flakiness/no-test-isolation -- `h` is this case's own harness, built above.
    await h.connect(ACME);
    expect(await pause(h, NOW)).toEqual({ kind: "invalid", code: "UNTIL_NOT_FUTURE" });
    expect(h.memory.tables.marketplaceStorePause.rows).toHaveLength(0);
  });

  it("queues every live connection that can be paused, and names the others", async () => {
    const { h } = setup();
    await h.connect(ACME);
    await h.connect(NOPAUSE);
    await h.engine.saveIntegration({ clientId: TENANT, provider: SWITCHY, enabled: true, externalMerchantId: null });
    const result = await pause(h, minutes(20));
    expect(result).toEqual({
      kind: "ok",
      marketplaces: [
        { provider: ACME, outcome: "queued" },
        { provider: NOPAUSE, outcome: "unsupported" },
        { provider: SWITCHY, outcome: "not-connected" },
      ],
    });
    expect(pauseRow(h)).toMatchObject({ state: "PAUSING", wanted: "PAUSED", until: minutes(20), timeZone: "America/Sao_Paulo" });
    expect(h.queued.filter((job) => job.name === MARKETPLACE_AVAILABILITY_JOB)).toHaveLength(1);
  });
});

describe("the availability job", () => {
  it("closes the store until the kitchen's estimate and records the closure it created", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    expect(await drain(h, seen)).toEqual([{ kind: "done", state: "PAUSED" }]);
    const row = pauseRow(h)!;
    expect(row).toMatchObject({ state: "PAUSED", sentUntil: minutes(20), attemptKey: null, leaseUntil: null });
    expect(acme.closures.get(row.externalId as string)).toEqual({ until: minutes(20), byHand: false });
    expect(h.published).toContain(TENANT);
  });

  it("does nothing for an equal or earlier end, and renews a later one without opening the store in between", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    await drain(h, seen);
    const first = pauseRow(h)!.externalId as string;

    expect(await pause(h, minutes(20))).toMatchObject({ marketplaces: [{ provider: ACME, outcome: "unchanged" }] });
    expect(await pause(h, minutes(10))).toMatchObject({ marketplaces: [{ provider: ACME, outcome: "unchanged" }] });
    expect(takeJobs(h, { count: seen.count })).toHaveLength(0);

    await pause(h, minutes(35));
    await drain(h, seen);
    const row = pauseRow(h)!;
    expect(row).toMatchObject({ state: "PAUSED", sentUntil: minutes(35), retiredExternalId: null });
    expect(row.externalId).not.toBe(first);
    // Created the later one FIRST, then deleted the earlier: never open in between.
    expect(acme.calls.slice(-2)).toEqual([`pause:${minutes(35).toISOString()}`, `resume:${first}`]);
    expect([...acme.closures.keys()]).toEqual([row.externalId]);
  });

  it("fails a refusal with a code and the marketplace's own words, never a sentence of its own", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    acme.script.push("refused");
    await pause(h, minutes(20));
    expect(await drain(h, seen)).toEqual([{ kind: "failed", code: "PAUSE_REFUSED" }]);
    const [view] = (await h.engine.availabilityState(TENANT)).filter((entry) => entry.provider === ACME);
    expect(view).toMatchObject({
      supported: true,
      kind: "interruption",
      state: "FAILED",
      failureCode: "PAUSE_REFUSED",
      failureDetail: "409: Loja fechada pelo parceiro",
    });
  });

  it("retries an unanswered call, and fails it as unanswered on the last attempt", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    acme.script.push("retry", "retry");
    await pause(h, minutes(20));
    const [payload] = takeJobs(h, seen);
    await expect(h.engine.runAvailability(payload!, { attempt: 1, maxAttempts: 2 })).rejects.toBeInstanceOf(AvailabilityRetryError);
    expect(pauseRow(h)).toMatchObject({ state: "PAUSING", leaseUntil: null });
    expect(await h.engine.runAvailability(payload!, { attempt: 2, maxAttempts: 2 })).toEqual({
      kind: "failed",
      code: "PAUSE_UNANSWERED",
    });
  });
});

describe("never deleting what the engine did not create", () => {
  it("resumes by deleting only its own closure; one the owner made by hand stays", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    acme.closures.set("by-hand", { until: minutes(120), byHand: true });
    await pause(h, minutes(20));
    await drain(h, seen);
    expect(await h.engine.resumeStore({ clientId: TENANT, now: NOW })).toEqual({
      marketplaces: [{ provider: ACME, outcome: "queued" }],
    });
    expect(await drain(h, seen)).toEqual([{ kind: "done", state: "OPEN" }]);
    expect([...acme.closures.keys()]).toEqual(["by-hand"]);
    expect(pauseRow(h)).toMatchObject({ state: "OPEN", wanted: "OPEN", externalId: null, sentUntil: null });
  });

  it("calls nobody to resume where nothing of its own stands", async () => {
    const { h, switchy } = setup();
    await h.connect(SWITCHY);
    const seen = { count: 0 };
    switchy.script.push("refused");
    await pause(h, minutes(20));
    await drain(h, seen);
    expect(switchy.calls).toEqual(["off"]);
    // The pause was refused: the engine never turned the store off, so it never turns it on.
    expect(pauseRow(h, SWITCHY)).toMatchObject({ state: "FAILED", attemptKey: null });
    expect(await h.engine.resumeStore({ clientId: TENANT, now: NOW })).toEqual({
      marketplaces: [{ provider: SWITCHY, outcome: "open" }],
    });
    expect(takeJobs(h, seen)).toHaveLength(0);
    expect(switchy.calls).toEqual(["off"]);
  });

  it("turns a switch back on only after turning it off itself", async () => {
    const { h, switchy } = setup();
    await h.connect(SWITCHY);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    await drain(h, seen);
    expect(switchy.state.enabled).toBe(false);
    await h.engine.resumeStore({ clientId: TENANT, now: NOW });
    await drain(h, seen);
    expect(switchy.calls).toEqual(["off", "on"]);
    expect(switchy.state.enabled).toBe(true);
  });
});

describe("races: the last ask wins", () => {
  it("resume before the pause job runs: no closure is ever created", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    await h.engine.resumeStore({ clientId: TENANT, now: NOW });
    const [first, ...later] = await drain(h, seen);
    expect(first).toEqual({ kind: "done", state: "OPEN" });
    for (const outcome of later) expect(outcome).toMatchObject({ kind: "skipped" });
    expect(acme.closures.size).toBe(0);
    expect(acme.calls.some((call) => call.startsWith("pause:"))).toBe(false);
  });

  it("resume while the pause call is in flight: the closure it created is recorded, then deleted", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    acme.during.pause.push(async () => {
      await h.engine.resumeStore({ clientId: TENANT, now: NOW });
    });
    const [payload] = takeJobs(h, seen);
    expect(await h.engine.runAvailability(payload!, { attempt: 1, maxAttempts: 3 })).toEqual({ kind: "done", state: "OPEN" });
    expect(acme.closures.size).toBe(0);
    expect(pauseRow(h)).toMatchObject({ state: "OPEN", externalId: null });
  });

  it("pause while the resume call is in flight: the old closure goes, a new one with the new end stands", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    await drain(h, seen);
    await h.engine.resumeStore({ clientId: TENANT, now: NOW });
    acme.during.resume.push(async () => {
      await pause(h, minutes(40));
    });
    const outcomes = await drain(h, seen);
    expect(outcomes[0]).toEqual({ kind: "done", state: "PAUSED" });
    const row = pauseRow(h)!;
    expect(row).toMatchObject({ state: "PAUSED", wanted: "PAUSED", sentUntil: minutes(40) });
    expect([...acme.closures.values()]).toEqual([{ until: minutes(40), byHand: false }]);
  });

  it("a lost answer makes no second closure: the retry finds it under the same key", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    acme.script.push("lost");
    await pause(h, minutes(20));
    const [payload] = takeJobs(h, seen);
    await expect(h.engine.runAvailability(payload!, { attempt: 1, maxAttempts: 3 })).rejects.toBeInstanceOf(AvailabilityRetryError);
    expect(await h.engine.runAvailability(payload!, { attempt: 2, maxAttempts: 3 })).toEqual({ kind: "done", state: "PAUSED" });
    expect(acme.closures.size).toBe(1);
    expect(pauseRow(h)!.externalId).toBe([...acme.closures.keys()][0]);
  });

  it("a pause whose every answer was lost is still deleted on resume, found under its key", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    acme.script.push("lost");
    await pause(h, minutes(20));
    const [payload] = takeJobs(h, seen);
    expect(await h.engine.runAvailability(payload!, { attempt: 1, maxAttempts: 1 })).toEqual({
      kind: "failed",
      code: "PAUSE_UNANSWERED",
    });
    expect(acme.closures.size).toBe(1);
    expect(await h.engine.resumeStore({ clientId: TENANT, now: NOW })).toMatchObject({
      marketplaces: [{ provider: ACME, outcome: "queued" }],
    });
    await drain(h, seen);
    expect(acme.closures.size).toBe(0);
    expect(pauseRow(h)).toMatchObject({ state: "OPEN", attemptKey: null });
  });

  it("two runs never call the marketplace at once: the second waits for the lease", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    const [payload] = takeJobs(h, seen);
    const second: Promise<unknown>[] = [];
    acme.during.pause.push(async () => {
      second.push(h.engine.runAvailability(payload!, { attempt: 1, maxAttempts: 3 }));
      await expect(second[0]).rejects.toBeInstanceOf(AvailabilityRetryError);
    });
    await h.engine.runAvailability(payload!, { attempt: 1, maxAttempts: 3 });
    expect(second).toHaveLength(1);
    expect(acme.calls.filter((call) => call.startsWith("pause:"))).toHaveLength(1);
  });
});

describe("the availability sweep", () => {
  it("resumes a pause past its end that nobody renewed: never closed past the kitchen's pause", async () => {
    const { h, switchy } = setup();
    await h.connect(SWITCHY);
    const seen = { count: 0 };
    await pause(h, minutes(20));
    await drain(h, seen);
    h.clock.at = minutes(21);
    expect(await h.engine.sweepAvailability()).toEqual({ expired: 1, requeued: 0, givenUp: 0 });
    await drain(h, seen);
    expect(switchy.state.enabled).toBe(true);
    expect(pauseRow(h, SWITCHY)).toMatchObject({ state: "OPEN", wanted: "OPEN" });
  });

  it("re-queues an ask the queue refused, once older than the job's retry span", async () => {
    const { h } = setup({ queueDown: true });
    await h.connect(ACME);
    await pause(h, minutes(60));
    h.clock.at = minutes(5);
    expect(await h.engine.sweepAvailability()).toMatchObject({ requeued: 0 });
    h.clock.at = minutes(11);
    const before = h.enqueued.length;
    await h.engine.sweepAvailability();
    expect(h.enqueued.length).toBe(before + 1);
    expect(h.enqueued.at(-1)?.dedupeKey).toMatch(/:sweep:/u);
  });

  it("gives up on an ask older than a day, as unanswered", async () => {
    const { h } = setup({ queueDown: true });
    await h.connect(ACME);
    await pause(h, minutes(60));
    await h.engine.resumeStore({ clientId: TENANT, now: NOW });
    const row = pauseRow(h)!;
    row.state = "RESUMING";
    h.clock.at = minutes(25 * 60);
    expect(await h.engine.sweepAvailability()).toMatchObject({ givenUp: 1 });
    expect(pauseRow(h)).toMatchObject({ state: "FAILED", failureCode: "RESUME_UNANSWERED" });
  });

  it("retries a failed resume that still holds a closure", async () => {
    const { h, acme } = setup();
    await h.connect(ACME);
    const seen = { count: 0 };
    await pause(h, minutes(120));
    await drain(h, seen);
    await h.engine.resumeStore({ clientId: TENANT, now: NOW });
    acme.script.push("refused");
    expect(await drain(h, seen)).toEqual([{ kind: "failed", code: "RESUME_REFUSED" }]);
    h.clock.at = minutes(11);
    expect(await h.engine.sweepAvailability()).toMatchObject({ requeued: 1 });
    await drain(h, seen);
    expect(acme.closures.size).toBe(0);
    expect(pauseRow(h)).toMatchObject({ state: "OPEN" });
  });
});

describe("a host without the pause model", () => {
  it("is told what to migrate on pause, and reads every marketplace OPEN", async () => {
    const memory = createMemoryDb();
    const tables: Partial<typeof memory.tables> = { ...memory.tables };
    delete tables.marketplaceStorePause;
    const store = { db: tables as MarketplaceDb, transaction: memory.transaction };
    const h = createHarness({ adapters: [adapter(ACME, interruptionMarketplace().availability)], store });
    await h.connect(ACME);
    await expect(pause(h, minutes(20))).rejects.toThrow(/20261113180000_marketplace_store_pause/u);
    expect(await h.engine.availabilityState(TENANT)).toMatchObject([{ provider: ACME, state: "OPEN", supported: true }]);
    expect(await h.engine.sweepAvailability()).toEqual({ expired: 0, requeued: 0, givenUp: 0 });
  });
});
