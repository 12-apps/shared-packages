import { cancelCharge, consultCharge, paidRefs, raiseCardOrder } from './orders';
import { PAGBANK_SANDBOX_WALLET_CENTS } from './sandbox-buyer';
import { clockOf, pendingStep, stepOf } from './steps';
import type { BrowserWalletResult, EvidenceStep, EvidenceStepKey, EvidenceWallet, EvidenceWalletsConfig } from './types';
import type { EvidenceRunDeps } from './run';

/**
 * The GOOGLE PAY and APPLE PAY sections of an evidence run (FUT-3755): a
 * wallet token the browser obtained from the wallet's own sheet, charged as a
 * card order with `card.wallet { type, key }` through the host's gateway,
 * consulted and canceled — the debit section's shape, through the same
 * helpers.
 *
 * The sheet needs a user gesture, so it cannot run inside the "generate"
 * chain: the operator presses the wallet's button first and the browser hands
 * the token to phase 2 with the cards. A wallet whose button was not pressed,
 * whose sheet failed, or (Apple Pay) whose identity the host does not have yet
 * stays PENDING with why — nothing is charged without a token.
 */

/** Each wallet's step-key prefix, as `SECTION_BY_PREFIX` names it. */
const PREFIX = { GOOGLE_PAY: 'gpay', APPLE_PAY: 'apay' } as const satisfies Record<EvidenceWallet, string>;

type WalletKey<W extends EvidenceWallet, S extends string> = `${(typeof PREFIX)[W]}.${S}`;

/** One wallet's four scenarios, in the order the file prints them. */
function keysOf<W extends EvidenceWallet>(wallet: W) {
  const prefix = PREFIX[wallet];
  return {
    token: `${prefix}.token` as WalletKey<W, 'token'>,
    approved: `${prefix}.approved` as WalletKey<W, 'approved'>,
    consult: `${prefix}.consult` as WalletKey<W, 'consult'>,
    cancel: `${prefix}.cancel` as WalletKey<W, 'cancel'>,
  };
}

/** The phase-2 wallet scenarios, in the order the file prints them. */
export const WALLET_ORDER_KEYS: readonly EvidenceStepKey[] = (['GOOGLE_PAY', 'APPLE_PAY'] as const).flatMap((wallet) =>
  Object.values(keysOf(wallet)),
);

/** What the browser needs to open each sheet — Google's against the seller's PagBank account. */
export async function walletsConfig(deps: EvidenceRunDeps, accountId: string | null): Promise<EvidenceWalletsConfig> {
  return {
    amountCents: PAGBANK_SANDBOX_WALLET_CENTS,
    googlePay: accountId ? { gateway: 'pagbank', gatewayMerchantId: accountId, environment: 'TEST' } : null,
    applePay: { configured: (await deps.applePayConfigured?.()) === true },
  };
}

/** The card the wallet showed, as the note prints it — never the token. */
function described(result: BrowserWalletResult): string {
  return [result.brand, result.last4 ? `**** ${result.last4}` : null].filter(Boolean).join(' ');
}

/** Why the wallet cannot be charged, or null when the browser has its token. */
function blockedBecause(
  deps: EvidenceRunDeps,
  wallet: EvidenceWallet,
  result: BrowserWalletResult | undefined,
  configured: boolean,
): string | null {
  const name = deps.copy.walletNames[wallet];
  if (wallet === 'APPLE_PAY' && !configured) return deps.copy.applePayNotConfigured;
  if (!result) return deps.copy.walletNotRun(name);
  if (result.token) return null;
  return deps.copy.walletFailed(name, deps.copy.walletFailures[result.failure ?? 'TOKEN_ERROR']);
}

/** One wallet's section: the browser's token as a note, then the order, consult and cancel. */
async function walletSteps(
  deps: EvidenceRunDeps,
  runId: string,
  wallet: EvidenceWallet,
  results: readonly BrowserWalletResult[],
  configured: boolean,
): Promise<EvidenceStep[]> {
  const keys = keysOf(wallet);
  const result = results.find((candidate) => candidate.type === wallet);
  const card = result ? described(result) : '';
  // The note says a key WAS sent and where, never what it was.
  const notes = result?.token ? [[`card.wallet.type=${wallet}`, card, 'card.wallet.key=***REDACTED***'].filter(Boolean).join(' · ')] : [];
  const blocked = blockedBecause(deps, wallet, result, configured);
  if (blocked !== null || !result?.token) {
    const why = blocked ?? deps.copy.notRun;
    return Object.values(keys).map((key) => pendingStep(key, deps.copy, why));
  }
  const token = stepOf(keys.token, 'EXECUTED', clockOf(deps)(), {
    notes,
    observed: deps.copy.walletTokenReceived(deps.copy.walletNames[wallet], card),
  });
  const approved = await raiseCardOrder(deps, {
    key: keys.approved,
    expected: 'PAID',
    reference: `homolog-${runId.slice(0, 8)}-${PREFIX[wallet]}`,
    amountCents: PAGBANK_SANDBOX_WALLET_CENTS,
    card: { wallet: { type: wallet, key: result.token }, installments: 1 },
    notes,
  });
  const { chargeId, orderId } = paidRefs(approved);
  const consult = chargeId ? await consultCharge(deps, keys.consult, chargeId, orderId) : pendingStep(keys.consult, deps.copy);
  const cancel = chargeId ? await cancelCharge(deps, keys.cancel, chargeId, orderId) : pendingStep(keys.cancel, deps.copy);
  return [token, approved.step, consult, cancel];
}

/** Phase 2: both wallets' sections, Google Pay first. */
export async function walletSectionSteps(
  deps: EvidenceRunDeps,
  runId: string,
  results: readonly BrowserWalletResult[],
): Promise<EvidenceStep[]> {
  const configured = (await deps.applePayConfigured?.()) === true;
  return [
    ...(await walletSteps(deps, runId, 'GOOGLE_PAY', results, configured)),
    ...(await walletSteps(deps, runId, 'APPLE_PAY', results, configured)),
  ];
}
