import type { AdapterCallContext, OutboundResult } from "./adapter";
import type { MarketplaceAvailability, StorePauseRef } from "./pause-port";
import type { StorePauseRow } from "./pause-store";
import type { EngineContext } from "./ports";

/**
 * The closures a renewal replaced, still to be deleted (FUT-4851).
 *
 * A renewal creates the new closure first and deletes the old one after, so
 * the store is never open in between; an old closure whose delete has not
 * answered yet waits here. Each entry keeps the END the marketplace was given,
 * because past it the closure is over by itself: it is then dropped without a
 * call. A final refusal drops it too (the marketplace says there is nothing it
 * will delete), and the list is capped at {@link RETIRED_CAP}, the oldest
 * dropped with a log line, so a delete that keeps failing never makes every
 * run call more.
 *
 * An entry names the closure by the marketplace's id or, for a create whose
 * answer was lost, by the key it went out under (found again by the end and
 * the reason it carried). Stored as `id:<id>@<end>` / `key:<key>@<end>`,
 * space-separated, oldest first, in `retired_external_ids`.
 */

/** One replaced closure still to delete. */
export interface RetiredClosure {
  by: "id" | "key";
  value: string;
  /** The end the marketplace was given; null when unknown (kept until a delete answers). */
  end: Date | null;
}

/** At most this many replaced closures are kept. */
export const RETIRED_CAP = 10;

function parse(token: string): RetiredClosure | null {
  const at = token.lastIndexOf("@");
  const head = at === -1 ? token : token.slice(0, at);
  const end = at === -1 ? null : new Date(token.slice(at + 1));
  const valid = end !== null && !Number.isNaN(end.getTime()) ? end : null;
  if (head.startsWith("key:")) return { by: "key", value: head.slice(4), end: valid };
  const value = head.startsWith("id:") ? head.slice(3) : head;
  return value === "" ? null : { by: "id", value, end: valid };
}

/** The replaced closures on a record, oldest first. */
export function retiredOf(row: Pick<StorePauseRow, "retiredExternalIds">): RetiredClosure[] {
  return (row.retiredExternalIds ?? "")
    .split(" ")
    .filter((token) => token !== "")
    .map(parse)
    .filter((entry): entry is RetiredClosure => entry !== null);
}

/** The column's value for a list. */
export function retiredValue(list: readonly RetiredClosure[]): string | null {
  if (list.length === 0) return null;
  return list.map((entry) => `${entry.by}:${entry.value}${entry.end ? `@${entry.end.toISOString()}` : ""}`).join(" ");
}

/** The list with one more entry, capped: the oldest beyond the cap is dropped and logged. */
export function withRetired(ctx: EngineContext, row: StorePauseRow, entry: RetiredClosure): RetiredClosure[] {
  const list = [...retiredOf(row), entry];
  const dropped = list.splice(0, Math.max(0, list.length - RETIRED_CAP));
  for (const gone of dropped) {
    ctx.ports.logger.warn(
      `marketplace.availability: ${row.provider} for ${row.clientId}: more than ${RETIRED_CAP} replaced closures; ` +
        `${gone.by} ${gone.value} is no longer deleted (it ends on its own${gone.end ? ` at ${gone.end.toISOString()}` : ""})`,
    );
  }
  return list;
}

/** Whether a closure's own end has passed: it is over, nothing to delete. */
export const ended = (entry: RetiredClosure, now: Date): boolean => entry.end !== null && entry.end.getTime() <= now.getTime();

/** The ref one entry is deleted by. */
export function refOf(entry: RetiredClosure, row: StorePauseRow, merchantId: string): StorePauseRef {
  if (entry.by === "id") return { merchantId, externalId: entry.value, key: null, sent: null };
  const sent = entry.end ? { until: entry.end, reason: row.reason ?? "", timeZone: row.timeZone ?? "UTC" } : null;
  return { merchantId, externalId: null, key: entry.value, sent };
}

interface RetireEnv {
  ctx: EngineContext;
  availability: MarketplaceAvailability;
  call: AdapterCallContext;
  merchantId: string;
}

/**
 * Delete every replaced closure: one past its end is dropped without a call;
 * a delete that answered, or was refused for good, leaves the list; one with
 * no answer stays for the next run or the sweep. Never throws for the
 * marketplace's answer, so it never blocks a renewal. Returns the list left.
 */
export async function retire(env: RetireEnv, row: StorePauseRow): Promise<RetiredClosure[]> {
  const left: RetiredClosure[] = [];
  for (const entry of retiredOf(row)) {
    if (ended(entry, env.call.now)) continue;
    if (await stillOwed(env, row, entry)) left.push(entry);
  }
  return left;
}

/** Delete one entry; true when it stays on the list (no answer), false when it leaves (done, or refused for good). */
async function stillOwed(env: RetireEnv, row: StorePauseRow, entry: RetiredClosure): Promise<boolean> {
  let result: OutboundResult;
  try {
    result = await env.availability.resume(env.call, refOf(entry, row, env.merchantId));
  } catch (error) {
    result = { kind: "retry", reason: error instanceof Error ? error.message : String(error) };
  }
  if (result.kind === "accepted") return false;
  const refused = result.kind === "refused";
  const why = result.kind === "refused" ? `refused ${result.status}: ${result.message}` : result.reason;
  env.ctx.ports.logger.warn(
    `marketplace.availability: ${row.provider} for ${row.clientId}: the replaced closure ${entry.by} ${entry.value} ` +
      `was not deleted (${why})${refused ? "; dropped" : "; the sweep retries it"}`,
  );
  return !refused;
}
