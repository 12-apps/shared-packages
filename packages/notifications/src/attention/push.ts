/**
 * An attention item's PUSH, and which devices take it.
 *
 * The button rings and buzzes while its app is open; a push is what reaches a
 * phone in a pocket. A host sends one through the ordinary notification
 * pipeline — a generator, a category, the reader's channel preferences — and
 * marks it as attention by putting the item's severity under one reserved
 * `data` key. The WEB_PUSH transport then hands it only to the devices whose
 * OWN level wants that severity (`push_subscriptions.attention_push`, the
 * device's setting, sent by its app): `off` takes none, `late` only what turned
 * urgent, `all` everything. A notification without the key is not attention
 * and reaches every device as before; a device that never said takes all.
 *
 * Framework-free: the server's transport and a host's app both read it.
 */
import {
  ATTENTION_SEVERITIES,
  channelWants,
  type AttentionChannelLevel,
  type AttentionSeverity,
} from './core';

/**
 * The reserved `data` key an attention notification carries its severity
 * under — next to `liveSubject`, the other key the transport reads.
 */
export const ATTENTION_DATA_KEY = 'attention';

/** The severity a notification's `data` declares, or `null` for one that is not attention. */
export function attentionSeverityOf(
  data: Record<string, unknown> | null | undefined,
): AttentionSeverity | null {
  const value = data?.[ATTENTION_DATA_KEY];
  return typeof value === 'string' && (ATTENTION_SEVERITIES as readonly string[]).includes(value)
    ? (value as AttentionSeverity)
    : null;
}

/**
 * Does a device whose attention-push level is `level` take a push at
 * `severity`? A push that is not attention (`null`) and a device that never
 * set a level (`null`, or a value this version does not know) both say yes.
 */
export function wantsAttentionPush(
  level: string | null | undefined,
  severity: AttentionSeverity | null,
): boolean {
  if (severity === null) return true;
  if (level !== 'off' && level !== 'late' && level !== 'all') return true;
  return channelWants(level as AttentionChannelLevel, severity);
}
