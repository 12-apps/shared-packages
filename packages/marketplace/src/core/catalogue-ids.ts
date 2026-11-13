import { createHash } from "node:crypto";

/**
 * A UUID v4-shaped id derived from a seed, the same for the same seed (FUT-4768).
 *
 * Some marketplaces make the store's software invent the id of a catalogue
 * entity (iFood's Catalog API v2.0 and Open Delivery both want a UUID the
 * software generates). Deriving it from the engine's stable publication
 * reference, instead of drawing a random one, makes a retried publish whose
 * first answer was lost name the SAME item rather than a second one, and needs
 * no write before the call.
 */
export function stableUuid(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
