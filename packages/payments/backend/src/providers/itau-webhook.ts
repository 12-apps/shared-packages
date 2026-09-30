import { stubDeliveryTrusted } from '../core/stub-mode';
import type { NormalizedWebhookEvent, ResolvedCredentials, WebhookDelivery } from '../core/types';
import { itauSession, NAME, readCob } from './itau-http';
import { centsFrom, refundSnapshotOf, snapshotFromCob, type ItauCob, type ItauPix } from './itau-pix';
import { sha256Hex } from './shared';

/**
 * The Itaú webhook half.
 *
 * Pix webhooks follow the BACEN spec: the PSP POSTs `{ pix: [...] }` to the
 * URL registered through `PUT /webhook/{chave}`, authenticating ITSELF over
 * mTLS. That registration takes a `webhookUrl` and nothing else — no header,
 * no secret, no signature a merchant can configure — so a shared-secret gate
 * could never be satisfied by a genuine delivery (InfinitePay's store learned
 * that in production; see `infinitepay-webhook.ts`). A host behind a TLS
 * terminator cannot see Itaú's client certificate either.
 *
 * So a delivery is believed only when ITAÚ confirms it when re-asked: every
 * entry's cob is read back over this merchant's own authenticated session,
 * and the entry must be a Pix that cob actually received. A forger can
 * therefore only "confirm" money that really reached the merchant.
 */

interface ItauWebhookBody {
  pix?: ItauPix[];
}

type ConfirmableEntry = ItauPix & { txid: string; endToEndId: string };

function entriesOf(rawBody: string): ConfirmableEntry[] | null {
  let body: ItauWebhookBody;
  try {
    body = JSON.parse(rawBody) as ItauWebhookBody;
  } catch {
    return null;
  }
  if (!Array.isArray(body.pix)) return null;
  // A Pix paid to the key without a cob (a static QR, a manual transfer) has
  // no txid: nothing this adapter raised, so nothing to confirm or report.
  return body.pix.filter((entry): entry is ConfirmableEntry => Boolean(entry.txid && entry.endToEndId));
}

/** The Pix inside `cob` that `entry` claims to be, or undefined when the cob received no such Pix. */
function receivedPix(cob: ItauCob, entry: ConfirmableEntry): ItauPix | undefined {
  if (cob.txid !== entry.txid) return undefined;
  return cob.pix?.find((pix) => pix.endToEndId === entry.endToEndId);
}

/**
 * Authenticate a delivery by asking Itaú. FAIL CLOSED: a body that does not
 * parse, names no cob, or holds ONE entry Itaú will not confirm is refused
 * whole — Itaú retries, and a real payment also surfaces on `getCharge`.
 */
export async function verifyItauWebhook(delivery: WebhookDelivery, credentials: ResolvedCredentials): Promise<boolean> {
  if (stubDeliveryTrusted(credentials)) return true;
  const entries = entriesOf(delivery.rawBody);
  if (!entries || entries.length === 0) return false;
  try {
    const call = await itauSession(credentials);
    for (const entry of entries) {
      if (!receivedPix(await readCob(call, entry.txid), entry)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Stub mode makes no network call, so the body IS the fixture there. */
function stubEvents(entries: ConfirmableEntry[]): NormalizedWebhookEvent[] {
  return entries.map((entry) => ({
    provider: NAME,
    eventId: `${entry.endToEndId}:PAID`,
    type: 'CHARGE_UPDATED' as const,
    charge: {
      provider: NAME,
      providerChargeId: entry.txid,
      status: 'PAID' as const,
      amount: { amountCents: centsFrom(entry.valor) ?? 0, currency: 'BRL' as const },
      method: 'PIX' as const,
      raw: entry,
    },
    raw: entry,
  }));
}

/**
 * The events behind one confirmed entry, read from the SAME trusted source
 * that verified it: the body is unsigned, so its `valor` is an anonymous
 * claim and never what the snapshot reports. BACEN re-notifies a Pix when a
 * devolução on it moves, so each devolução is its own `REFUND_UPDATED`; the
 * event ids carry the state they report, because a later delivery for the
 * same end-to-end id is news, not a duplicate for the inbox to drop.
 */
function eventsFor(cob: ItauCob, pix: ItauPix, entry: ConfirmableEntry): NormalizedWebhookEvent[] {
  const charge = snapshotFromCob(cob);
  const refunds = (pix.devolucoes ?? []).map((devolucao) => {
    const refund = refundSnapshotOf(entry.txid, devolucao, 0);
    return {
      provider: NAME,
      eventId: `${entry.endToEndId}:${refund.providerRefundId}:${refund.status}`,
      type: 'REFUND_UPDATED' as const,
      refund,
      raw: devolucao,
    };
  });
  return [
    { provider: NAME, eventId: `${entry.endToEndId}:${charge.status}`, type: 'CHARGE_UPDATED', charge, raw: entry },
    ...refunds,
  ];
}

/** Parse an already-VERIFIED delivery into normalized events. */
export async function parseItauWebhook(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
): Promise<NormalizedWebhookEvent[]> {
  const entries = entriesOf(delivery.rawBody) ?? [];
  if (entries.length === 0) {
    return [{ provider: NAME, eventId: sha256Hex(delivery.rawBody), type: 'UNKNOWN', raw: delivery.rawBody }];
  }
  if (stubDeliveryTrusted(credentials)) return stubEvents(entries);
  const call = await itauSession(credentials);
  const events: NormalizedWebhookEvent[] = [];
  for (const entry of entries) {
    const cob = await readCob(call, entry.txid);
    const pix = receivedPix(cob, entry);
    if (pix) events.push(...eventsFor(cob, pix, entry));
  }
  return events;
}
