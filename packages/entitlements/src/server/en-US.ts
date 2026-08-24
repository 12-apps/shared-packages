import type { EntitlementsMessages } from './copy';
import type { EntitlementPermissionLabels } from './contribution';

/**
 * The en-US pack — a NAMED export a host passes by hand
 * (`messages: EN_US_ENTITLEMENTS_MESSAGES`), never a default. The filename is
 * what exempts this file from the copy-portability gate.
 *
 * Facts stay interpolated rather than written out, exactly as the pt-BR pack
 * does: a host that raises a ceiling or renames a tier must not end up with
 * copy naming the old number. A translation that inlined a limit would
 * reintroduce the staleness the interpolation exists to prevent.
 *
 * The WIRE codes stay the package's own — the `featureNotes` keys are the
 * `reason` discriminators both halves of the contract parse. Only the sentences
 * beside them are words.
 */
export const EN_US_ENTITLEMENTS_MESSAGES: EntitlementsMessages = {
  unauthenticated: 'Not authenticated.',
  planRequestForbidden: 'You do not have permission to request a plan change.',
  invalidPlanRequest: 'Invalid request.',
  paymentRequired: 'That feature is not included in your plan.',
  featureDisabledByTenant: 'That feature is switched off in your settings.',
  featureUnavailable: 'Feature unavailable.',
  featureNotes: {
    enabled: 'Included in your plan',
    'not-entitled': 'Not included in your plan',
    // Their own switch. Saying "not included" here would send them to buy a
    // tier that changes nothing. Deliberately does NOT name a screen — the
    // precise destination is a route, so the SPA that owns the routes names it,
    // keyed off `reason`.
    'disabled-by-tenant': 'Switched off by you in settings',
    restricted: 'Suspended while a payment is outstanding',
    suspended: 'Suspended — contact support',
  },
  overQuotaNote: ({ limit, used, nextPlanLabel }) => {
    const kept = `Your plan includes ${limit} and you have ${used}. All of them keep working`;
    // A null next tier must DROP the upsell clause rather than name a fallback:
    // a wrong upsell is the single most damaging thing the plan screen can
    // print, because it sells a tier that would not clear the ceiling.
    if (nextPlanLabel === null) return `${kept}.`;
    return `${kept} — to add more, move to ${nextPlanLabel}.`;
  },
  quotaRaceRetry: 'That could not be completed just now. Try again.',
  lossLine: (loss) => {
    const fate =
      loss.policy === 'readonly'
        ? 'keeps what it has, cannot grow'
        : loss.policy === 'hide'
          ? 'the area disappears'
          : 'becomes disabled';
    const range =
      loss.kind === 'narrowed' ? `${String(loss.before)} → ${String(loss.after)}` : 'lost';
    const upsell = loss.requiredPlan === null ? '' : ` (returns on "${loss.requiredPlan}")`;
    return `${loss.feature}: ${range} — ${fate}${upsell}`;
  },
  offLadderNote: ({ offLadder, total, defaultPlanKey }) =>
    `${offLadder}/${total} on a tier off the ladder (a retired key, or one written ` +
    `by hand) with NO active subscription. The resolver already treats them as ` +
    `"${defaultPlanKey}", and that is the ceiling they were measured against above.`,
  unscorableNote: ({ unscorable, total }) =>
    `${unscorable}/${total} have an active subscription on a plan off the ladder. ` +
    `Their limits come from the subscription's frozen snapshot, which the catalog does ` +
    `not model — they were left OUT of the count above and need checking by hand.`,
  tierBreakdownAboveTop: ({ topTier, count }) => `⚠️ above ${topTier} ${count}`,
  tierBreakdownOffLadder: ({ tier, count }) => `⚠️ ${tier} ${count}`,
};

/**
 * The segment words `entitlementsPermissions` used to compile in — the role
 * editor's vocabulary for this package's one id. Passed by hand at the
 * composition seam (`entitlementsPermissions(EN_US_ENTITLEMENTS_PERMISSION_LABELS)`),
 * which lives beside the host's own catalog rather than behind the mount.
 */
export const EN_US_ENTITLEMENTS_PERMISSION_LABELS: EntitlementPermissionLabels = {
  domains: { plan: 'Plan' },
  actions: { request: 'Request a change' },
};
