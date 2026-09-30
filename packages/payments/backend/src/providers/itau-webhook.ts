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

/**
 * Bounds checked BEFORE any network call. The body is unsigned and the URL is
 * public, so every entry would otherwise buy an attacker one authenticated
 * `GET /cob` on the merchant's own credentials — enough to spend Itau's rate
 * limit and have genuine deliveries fail closed. BACEN batches a handful of
 * Pix per delivery; twenty is generous.
 */
const MAX_ENTRIES = 20;
/** BACEN: a txid is 26–35 alphanumerics (what `itauTxId` mints); an end-to-end id is exactly 32. */
const TXID_SHAPE = /^[a-zA-Z0-9]{26,35}$/;
const E2E_SHAPE = /^[a-zA-Z0-9]{32}$/;

/**
 * The entries this adapter could have raised, or null for a body to refuse
 * whole: unparseable, oversized, or naming a txid / end-to-end id no real
 * Pix carries. A Pix paid to the key without a cob (a static QR, a manual
 * transfer) has no txid — nothing this adapter raised — and is skipped.
 */
function entriesOf(rawBody: string): ConfirmableEntry[] | null {
  let body: ItauWebhookBody;
  try {
    body = JSON.parse(rawBody) as ItauWebhookBody;
  } catch {
    return null;
  }
  if (!Array.isArray(body.pix) || body.pix.length > MAX_ENTRIES) return null;
  const raised = body.pix.filter((entry) => entry.txid !== undefined);
  const wellFormed = raised.every(
    (entry) => TXID_SHAPE.test(String(entry.txid)) && E2E_SHAPE.test(String(entry.endToEndId ?? '')),
  );
  return wellFormed ? (raised as ConfirmableEntry[]) : null;
}

/** The Pix inside `cob` that `entry` claims to be, or undefined when the cob received no such Pix. */
function receivedPix(cob: ItauCob, entry: ConfirmableEntry): ItauPix | undefined {
  if (cob.txid !== entry.txid) return undefined;
  return cob.pix?.find((pix) => pix.endToEndId === entry.endToEndId);
}

/** One read per distinct cob, however many entries name it. */
async function cobsFor(credentials: ResolvedCredentials, entries: ConfirmableEntry[]): Promise<Map<string, ItauCob>> {
  const call = await itauSession(credentials);
  const cobs = new Map<string, ItauCob>();
  for (const txid of new Set(entries.map((entry) => entry.txid))) cobs.set(txid, await readCob(call, txid));
  return cobs;
}

/**
 * Authenticate a delivery by asking Itau. FAIL CLOSED: a body that does not
 * parse, breaks the bounds above, names no cob, or holds ONE entry Itau will
 * not confirm is refused whole — Itau retries, and a real payment also
 * surfaces on `getCharge`.
 */
export async function verifyItauWebhook(delivery: WebhookDelivery, credentials: ResolvedCredentials): Promise<boolean> {
  if (stubDeliveryTrusted(credentials)) return true;
  const entries = entriesOf(delivery.rawBody);
  if (!entries || entries.length === 0) return false;
  try {
    const cobs = await cobsFor(credentials, entries);
    return entries.every((entry) => {
      const cob = cobs.get(entry.txid);
      return cob !== undefined && receivedPix(cob, entry) !== undefined;
    });
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
  const cobs = await cobsFor(credentials, entries);
  return entries.flatMap((entry) => {
    const cob = cobs.get(entry.txid);
    const pix = cob ? receivedPix(cob, entry) : undefined;
    return cob && pix ? eventsFor(cob, pix, entry) : [];
  });
}
