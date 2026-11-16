import { createHash } from "node:crypto";

/** The inbox key of a raw body: its SHA-256, hex. A redelivery is the same bytes, so the same key. */
export function bodyHash(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}
