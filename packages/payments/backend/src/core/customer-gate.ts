import {
  type AttemptContext,
  type ChargeWalkDeps,
  recordAttempt,
} from './charge-context';
import { validateCustomer } from './customer-schema';
import type { CustomerFieldIssue, CustomerFieldKey } from './customer-schema';
import { CustomerRequirementsError } from './errors';
import type { PaymentProviderAdapter } from './provider';
import type { ProviderName } from './types';

/**
 * THE BUYER-REQUIREMENTS GATE (FUT-595): refuse to attempt a provider whose
 * declared `customerSchema` this charge cannot satisfy, BEFORE anything is
 * sent. Returns the failure the walk should advance past, or `null` when the
 * provider may be attempted; a PINNED call gets the precise typed error
 * instead, naming each missing/invalid field.
 *
 * Only issues on REQUIRED fields block. An optional field the buyer garbled
 * must not kill a charge the provider would accept — adapters already forward
 * only what they can use (PagBank's all-or-nothing `phones` split is the
 * precedent) — and a field the provider does not ask for is never even
 * validated, so it can never block. That is the property the old hardcoded
 * `CustomerInfo` optionality could not express.
 *
 * REDIRECT providers are exempt on purpose: their own hosted page is the
 * collector, so the declaration describes what THAT page will demand (e.g.
 * InfinitePay's phone) and what the host sends is merely a pre-fill. Blocking
 * here would break every store whose buyers type those fields on the
 * provider's page — which is all of them, today.
 *
 * THE INVARIANT THAT EXEMPTION RESTS ON, stated because it is not the same
 * fact the key expresses. `ClientTokenization` (core/types.ts) answers "how
 * does CARD DATA get from the browser to the provider", and the question here
 * is "who collects the buyer's fields". The two coincide only while:
 *
 *   1. every adapter declaring `REDIRECT` settles EVERY method it supports on
 *      its own hosted page (InfinitePay does — `hostedCheckoutUrl` for PIX and
 *      CARD alike), and
 *   2. no adapter declaring `NONE` hosts its collection, even though the type's
 *      own doc blesses `NONE` for "PIX/boleto only, OR hosted checkout".
 *
 * Today's four adapters satisfy both, which is why this is one line and not a
 * capability. Break either and the gate is silently wrong in a direction the
 * tests do not cover: a REDIRECT adapter taking PIX through a direct API would
 * have a genuine requirement UNENFORCED (the provider 400s instead of a clean
 * DEFINITELY_NOT_CHARGED skip), and a hosted-checkout adapter declaring `NONE`
 * would be wrongly BLOCKED on fields its own page collects — exactly the
 * InfinitePay breakage this exemption exists to prevent. The future-proof key
 * is a per-method "the provider's own page collects this" flag on the adapter,
 * not an adapter-wide tokenization mode; adding a fifth adapter that violates
 * either clause is the moment to introduce it rather than widen this check.
 * `customer-schema.test.ts` pins clause 1 for the shipped adapters so the
 * coupling cannot rot unnoticed.
 *
 * Participates in failover exactly like capability gating: nothing was sent,
 * so the skip is DEFINITELY_NOT_CHARGED and the walk advances with proof.
 * The other half of the failover answer — collect the UNION of the chain's
 * requirements up front — is documented on `unionCustomerFields`.
 */
export async function gateCustomerRequirements(
  deps: ChargeWalkDeps,
  ctx: AttemptContext,
  provider: ProviderName,
  adapter: PaymentProviderAdapter,
  pinned: boolean,
): Promise<{ provider: ProviderName; message: string } | null> {
  if (adapter.capabilities.tokenization === 'REDIRECT') return null;
  const blockers = validateCustomer(adapter.customerSchema, ctx.input.method, ctx.input.customer)
    .filter((issue) => issue.required);
  if (blockers.length === 0) return null;
  const message = customerRequirementsMessage(provider, blockers);
  await recordAttempt(deps, ctx, provider, {
    outcome: 'SKIPPED',
    failureBucket: 'DEFINITELY_NOT_CHARGED',
    error: message,
  });
  if (pinned) throw new CustomerRequirementsError(provider, blockers);
  return { provider, message };
}

/**
 * The wire text a gate skip carries into `NoProviderSucceededError.failures`.
 *
 * An UNPINNED walk reports its refusals as `{ provider, message }` strings —
 * that is the whole failure channel — so this text is the only place the typed
 * issues survive to. A host that must tell the buyer WHICH field to fix
 * therefore has to read it back, which is why the formatter and the recognizer
 * below are one pair in one file: two copies of this format, one writing and
 * one reading, would drift the first time a word changed and the host would
 * silently fall back to a generic 5xx for buyer input.
 */
export function customerRequirementsMessage(
  provider: ProviderName,
  issues: readonly CustomerFieldIssue[],
): string {
  return (
    `provider ${provider}${REQUIREMENTS_MARKER}` +
    issues.map((issue) => `${issue.field} (${issue.reason})`).join(', ')
  );
}

const REQUIREMENTS_MARKER = ' requires buyer fields: ';
const ISSUE_PATTERN = /^(name|email|taxId|phone) \((MISSING|INVALID)\)$/;

/**
 * Read a gate skip back off a walk failure, or `null` when the failure is
 * anything else — see {@link customerRequirementsMessage}.
 *
 * Every issue comes back `required: true`: only required issues ever reach the
 * message (the gate filters first), and it is requiredness that made the
 * provider unattemptable.
 */
export function parseCustomerRequirements(message: string): CustomerFieldIssue[] | null {
  const at = message.indexOf(REQUIREMENTS_MARKER);
  if (at < 0 || !message.startsWith('provider ')) return null;
  const issues: CustomerFieldIssue[] = [];
  for (const part of message.slice(at + REQUIREMENTS_MARKER.length).split(', ')) {
    const match = ISSUE_PATTERN.exec(part);
    if (!match) return null;
    issues.push({
      field: match[1] as CustomerFieldKey,
      reason: match[2] as CustomerFieldIssue['reason'],
      required: true,
    });
  }
  return issues.length > 0 ? issues : null;
}
