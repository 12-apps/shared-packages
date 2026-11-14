/** Pieces every built-in adapter's response mapping shares. */
import type { Refusal, StopReason } from "../types";

/** A token count the provider may have left out or nulled. */
export function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The refusal of a result, or null when the turn was not refused. */
export function refusalOf(stopReason: StopReason, category: string | null, explanation: string | null): Refusal | null {
  return stopReason === "refusal" ? { category, explanation } : null;
}
