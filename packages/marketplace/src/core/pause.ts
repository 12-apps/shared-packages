import type { EngineContext } from "./ports";
import {
  availabilityDedupeKey,
  enqueueAvailability,
  holdsSomething,
  pauseTable,
  readPause,
  type StorePauseFailureCode,
  type StorePauseRow,
  type StorePauseState,
  type StorePauseWanted,
} from "./pause-store";
import type { MarketplaceProvider } from "./types";

/**
 * The store pause, as the host calls it (FUT-4851): `pauseStore` when the
 * kitchen pauses and on every renewal, `resumeStore` the moment the pause is
 * over, `availabilityState` for the screen. The host owns the debounce; these
 * calls only record the ask and queue `marketplace.availability`, whose job
 * makes the calls (`./pause-job.ts`). No path that answers a request reaches
 * a marketplace.
 */

/** What `pauseStore` did on one marketplace. */
export type PauseOutcome =
  /** The ask was recorded and the job queued. */
  | "queued"
  /** A pause with exactly this end already stands or is on its way. */
  | "unchanged"
  /** The marketplace's adapter cannot pause a store: the host says so. */
  | "unsupported"
  /** The connection has no credentials or no merchant id. */
  | "not-connected";

/** What `resumeStore` did on one marketplace. */
export type ResumeOutcome =
  /** Something of ours stands on the marketplace: the job deletes it. */
  | "queued"
  /** Nothing of ours stands there: the record is OPEN, and nobody is called. */
  | "open"
  /** A resume is already on its way. */
  | "unchanged";

export interface PauseStoreInput {
  clientId: string;
  /** The kitchen's estimated reopening time: the end every marketplace is given. */
  until: Date;
  /** The host's words for the closure (its copy, in the store's language). */
  reason: string;
  /** The store's IANA time zone. */
  timeZone: string;
  now?: Date;
}

export type PauseStoreResult =
  | { kind: "invalid"; code: "UNTIL_NOT_FUTURE" | "TIME_ZONE_INVALID" }
  | { kind: "ok"; marketplaces: { provider: MarketplaceProvider; outcome: PauseOutcome }[] };

/** One marketplace's pause as the screen shows it. */
export interface StoreAvailabilityView {
  provider: MarketplaceProvider;
  /** The adapter can pause a store at all. */
  supported: boolean;
  /** `interruption` (an id and an end) or `switch` (on/off); null when unsupported. */
  kind: "interruption" | "switch" | null;
  /** The connection has credentials and a merchant id. */
  connected: boolean;
  state: StorePauseState;
  wanted: StorePauseWanted;
  /** The end the host asked for. */
  until: Date | null;
  /** The end the marketplace was given and confirmed. */
  sentUntil: Date | null;
  failureCode: StorePauseFailureCode | null;
  /** The marketplace's own words, verbatim and cut; never copy to show as is. */
  failureDetail: string | null;
  pausedAt: Date | null;
  resumedAt: Date | null;
  updatedAt: Date | null;
}

interface ConnectionRow {
  provider: string;
  externalMerchantId: string | null;
  credentials: string;
}

/** The store's live connections (enabled, not archived), with whether each can be called. */
async function liveConnections(ctx: EngineContext, clientId: string): Promise<ConnectionRow[]> {
  const db = await ctx.ports.db();
  return (await db.marketplaceIntegration.findMany({
    where: { clientId, enabled: true, archivedAt: null },
    select: { provider: true, externalMerchantId: true, credentials: true },
    orderBy: { provider: "asc" },
  })) as ConnectionRow[];
}

const isConnected = (row: ConnectionRow): boolean => row.credentials !== "" && Boolean(row.externalMerchantId);

/** Whether an IANA zone name is one this runtime knows. */
function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone !== "";
  } catch {
    return false;
  }
}

/**
 * Whether a pause with exactly this end already stands, or is on its way. An
 * earlier end is asked like a later one: the store is never closed on a
 * marketplace longer than the kitchen's own pause.
 */
function alreadyAsked(row: StorePauseRow | null, until: Date): boolean {
  if (!row || row.wanted !== "PAUSED") return false;
  if (row.state !== "PAUSING" && row.state !== "PAUSED") return false;
  return row.until !== null && row.until.getTime() === until.getTime();
}

/** Record one marketplace's pause and queue its job, unless it already stands. */
async function askPause(ctx: EngineContext, input: Required<PauseStoreInput>, provider: string): Promise<PauseOutcome> {
  const existing = await readPause(ctx, input.clientId, provider);
  if (alreadyAsked(existing, input.until)) return "unchanged";
  const table = pauseTable(await ctx.ports.db());
  const data = {
    wanted: "PAUSED",
    state: "PAUSING",
    until: input.until,
    reason: input.reason,
    timeZone: input.timeZone,
    requestedAt: input.now,
    // No key is minted here: the job writes one just before its call, so a
    // resume that lands first knows nothing of ours can stand there. A key
    // still in doubt stays on the row (its create may have landed).
    failureCode: null,
    failureDetail: null,
    failedAt: null,
  };
  await table.upsert({
    where: { clientId_provider: { clientId: input.clientId, provider } },
    create: { clientId: input.clientId, provider, ...data },
    update: data,
  });
  const payload = { clientId: input.clientId, provider };
  await enqueueAvailability(ctx, payload, availabilityDedupeKey(payload, input.now));
  return "queued";
}

/**
 * Pause the store on every live connection whose marketplace can be paused.
 * Idempotent: a pause already standing (or on its way) with exactly this end
 * does nothing; any other end renews it, an earlier one included. Called again
 * on every renewal of the kitchen's pause.
 */
export async function pauseStore(ctx: EngineContext, input: PauseStoreInput): Promise<PauseStoreResult> {
  const now = input.now ?? ctx.ports.clock.now();
  if (input.until.getTime() <= now.getTime()) return { kind: "invalid", code: "UNTIL_NOT_FUTURE" };
  if (!validTimeZone(input.timeZone)) return { kind: "invalid", code: "TIME_ZONE_INVALID" };
  pauseTable(await ctx.ports.db());
  const full = { ...input, now };
  const marketplaces: { provider: MarketplaceProvider; outcome: PauseOutcome }[] = [];
  for (const connection of await liveConnections(ctx, input.clientId)) {
    const adapter = ctx.registry.get(connection.provider);
    let outcome: PauseOutcome;
    if (!adapter?.availability) outcome = "unsupported";
    else if (!isConnected(connection)) outcome = "not-connected";
    else outcome = await askPause(ctx, full, connection.provider);
    marketplaces.push({ provider: connection.provider, outcome });
  }
  if (marketplaces.some((entry) => entry.outcome === "queued")) ctx.ports.publishChanged(input.clientId);
  return { kind: "ok", marketplaces };
}

/** Rewrite one record's ask to OPEN; queue the job only when something of ours stands there. */
async function askResume(ctx: EngineContext, row: StorePauseRow, now: Date): Promise<ResumeOutcome> {
  if (row.wanted === "OPEN" && (row.state === "RESUMING" || row.state === "OPEN")) return "unchanged";
  const table = pauseTable(await ctx.ports.db());
  const held = holdsSomething(row);
  await table.updateMany({
    where: { id: row.id },
    data: {
      wanted: "OPEN",
      state: held ? "RESUMING" : "OPEN",
      requestedAt: now,
      failureCode: null,
      failureDetail: null,
      failedAt: null,
      ...(held ? {} : { resumedAt: now }),
    },
  });
  if (!held) return "open";
  const payload = { clientId: row.clientId, provider: row.provider };
  await enqueueAvailability(ctx, payload, availabilityDedupeKey(payload, now));
  return "queued";
}

/**
 * The kitchen's pause is over: open the store again wherever the engine
 * closed it. Only what the engine created is deleted; a marketplace where
 * nothing of ours stands is not called at all. Every record is answered,
 * a connection disabled since the pause included.
 */
export async function resumeStore(
  ctx: EngineContext,
  input: { clientId: string; now?: Date },
): Promise<{ marketplaces: { provider: MarketplaceProvider; outcome: ResumeOutcome }[] }> {
  const now = input.now ?? ctx.ports.clock.now();
  const table = pauseTable(await ctx.ports.db());
  const rows = (await table.findMany({
    where: { clientId: input.clientId },
    orderBy: { provider: "asc" },
  })) as StorePauseRow[];
  const marketplaces: { provider: MarketplaceProvider; outcome: ResumeOutcome }[] = [];
  for (const row of rows) marketplaces.push({ provider: row.provider, outcome: await askResume(ctx, row, now) });
  if (marketplaces.some((entry) => entry.outcome !== "unchanged")) ctx.ports.publishChanged(input.clientId);
  return { marketplaces };
}

/** What a marketplace with no record reads as: OPEN, never asked. */
const NEVER_ASKED: Omit<StoreAvailabilityView, "provider" | "supported" | "kind" | "connected"> = {
  state: "OPEN",
  wanted: "OPEN",
  until: null,
  sentUntil: null,
  failureCode: null,
  failureDetail: null,
  pausedAt: null,
  resumedAt: null,
  updatedAt: null,
};

function viewOf(ctx: EngineContext, provider: string, connection: ConnectionRow | undefined, row: StorePauseRow | undefined): StoreAvailabilityView {
  const availability = ctx.registry.get(provider)?.availability;
  const recorded = row
    ? {
        state: row.state,
        wanted: row.wanted,
        until: row.until,
        sentUntil: row.sentUntil,
        failureCode: row.failureCode,
        failureDetail: row.failureDetail,
        pausedAt: row.pausedAt,
        resumedAt: row.resumedAt,
        updatedAt: row.updatedAt,
      }
    : NEVER_ASKED;
  return {
    provider,
    supported: availability !== undefined,
    kind: availability?.kind ?? null,
    connected: connection !== undefined && isConnected(connection),
    ...recorded,
  };
}

/**
 * Where the store's pause stands on each marketplace: every live connection,
 * plus any record of a connection since disabled that still holds something.
 * A host on a database without the pause model reads every marketplace OPEN.
 */
export async function availabilityState(ctx: EngineContext, clientId: string): Promise<StoreAvailabilityView[]> {
  const db = await ctx.ports.db();
  const connections = await liveConnections(ctx, clientId);
  const rows = db.marketplaceStorePause
    ? ((await db.marketplaceStorePause.findMany({ where: { clientId } })) as StorePauseRow[])
    : [];
  const byProvider = new Map(rows.map((row) => [row.provider, row]));
  const views = connections.map((connection) =>
    viewOf(ctx, connection.provider, connection, byProvider.get(connection.provider)),
  );
  const live = new Set(connections.map((connection) => connection.provider));
  for (const row of rows) {
    if (!live.has(row.provider) && holdsSomething(row)) views.push(viewOf(ctx, row.provider, undefined, row));
  }
  return views;
}
