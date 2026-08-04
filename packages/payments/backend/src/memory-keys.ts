import type { MerchantRef } from './core/types';

/**
 * Merchant-scoped map keys for the in-memory ports.
 *
 * Shared by `memory.ts` and `memory-webhook-inbox.ts` rather than written twice
 * because the rule below is the whole point of them: two fakes that key
 * differently would disagree about which merchant owns what, which is exactly
 * the class of bug the real stores' composite constraints exist to prevent.
 */

// JSON-tuple keys, never delimiter concatenation: `${id}:${key}` would let
// distinct tuples collide (id "a" + key "b:c" vs id "a:b" + key "c").
export function merchantKey(merchant: MerchantRef): string {
  return JSON.stringify([merchant.kind, merchant.id]);
}

export function scopedKey(merchant: MerchantRef, ...parts: string[]): string {
  return JSON.stringify([merchant.kind, merchant.id, ...parts]);
}
