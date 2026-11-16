/**
 * The level a conversation reached, kept by the host and only ever RAISED.
 *
 * Two messages of one conversation can be in flight at once (a customer
 * sending two lines quickly). Each `handle()` call reads the level, runs its
 * model tiers, and only then records where it ended, so a plain write would
 * let a slow answer pull a conversation back down from a person, or let two
 * escalations both hand it off. The port therefore offers one write, an
 * atomic compare-and-set, and the ladder uses it only to move a conversation
 * UP: a tier answer never lowers the stored level, and only the call whose
 * raise to `"person"` succeeded hands the conversation off.
 */
import { SupportLadderError } from "../errors";

/** The level a conversation is at once a person has it. */
export const WITH_PERSON = "person";

type Awaitable<T> = T | Promise<T>;

/** Where the host keeps the level each conversation reached. */
export interface SupportStatePort {
  /** A tier id, `"person"`, or nothing for a conversation that reached no tier. */
  get(conversationId: string): Awaitable<string | null | undefined>;
  /**
   * ATOMIC on the host's side: when the stored level is still `from` (`null`:
   * nothing stored), store `to` and return true; otherwise change nothing and
   * return false. One conditional write, e.g. `UPDATE … SET level = $to WHERE
   * id = $id AND level = $from` (an insert that loses on the key when `from`
   * is null) and true when it touched a row. The ladder only ever raises.
   */
  raise(conversationId: string, from: string | null, to: string): Awaitable<boolean>;
}

/**
 * How a raise ended: this call moved the level, the level was already at or
 * above the target, or the conversation is with a person.
 */
type RaiseOutcome = "raised" | "held" | "with_person";

/** A level's height: -1 for none or an id that is no tier, the tier count for a person. */
type LevelRank = (level: string | null) => number;

export function levelRank(tierIds: readonly string[]): LevelRank {
  return (level) => (level === WITH_PERSON ? tierIds.length : level === null ? -1 : tierIds.indexOf(level));
}

/**
 * Raise a conversation to `to`, never lower it. A raise that loses re-reads
 * and tries again; with only raises in play that ends within one try per
 * level, so running out of `attempts` means a writer keeps moving the level.
 */
export async function raiseLevel(state: SupportStatePort, conversationId: string, to: string, rank: LevelRank, attempts: number): Promise<RaiseOutcome> {
  const current = (await state.get(conversationId)) ?? null;
  if (current === WITH_PERSON) return "with_person";
  if (rank(current) >= rank(to)) return "held";
  if (await state.raise(conversationId, current, to)) return "raised";
  if (attempts <= 1) throw new SupportLadderError("state_conflict", `the level of "${conversationId}" kept changing while it was being raised to "${to}".`);
  return raiseLevel(state, conversationId, to, rank, attempts - 1);
}
