import type { EntitlementsWebCopy } from './copy';

/**
 * The en-US pack — the same plan screens for an English-reading audience. The
 * filename is what exempts this file from the copy-portability gate.
 *
 * The `reasons` KEYS are wire codes the SPA branches on, not words: they stay
 * exactly as the package spells them. Only the title and body beside each are
 * translated.
 *
 * `disabled-by-tenant` keeps its distinct sentence in both maps. Collapsing it
 * into the generic "not included" would send someone to buy a tier that changes
 * nothing — their own switch is off, and no plan fixes that.
 */
export const EN_US_ENTITLEMENTS_WEB_COPY: EntitlementsWebCopy = {
  requestFailed: ({ status }) => `Request failed (${status}).`,
  planPage: {
    title: 'Plans',
    // Three fragments the screen concatenates: prefix, the plan's own name,
    // then the detail. The seam has to survive translation or the name lands
    // in the middle of a sentence that no longer reads.
    currentPlanPrefix: 'Your plan today is ',
    currentPlanDetail: ({ price }) => (price === null ? '.' : ` · ${price}.`),
    loadFailedTitle: 'Could not load your plan',
    requestReceived: ({ plan }) =>
      `We have your request for the ${plan} plan. We will be in touch to arrange the details.`,
    statusHeading: 'Your plan today',
    statusIntro: 'What is active right now — and, where it is not, why.',
    statusEmpty: 'No plan-managed features at the moment.',
    statusShowAll: ({ count }) => `Show every feature (+${String(count)})`,
    statusShowBlocked: 'Show only what is blocked',
    statusNothingBlocked: 'Everything your plan includes is on.',
    ceilingUnlimited: 'unlimited',
    ceilingUpTo: ({ limit }) => `up to ${String(limit)}`,
    availableOn: ({ planLabel }) => `Available on the ${planLabel} plan.`,
    openSwitch: ({ label }) => `Turn on in ${label}`,
    statusBadge: { enabled: 'On', disabled: 'Unavailable' },
  },
  tierCards: {
    currentBadge: 'YOUR PLAN',
    recommendedBadge: 'BEST VALUE',
    priceUnpriced: 'On request',
    currentAction: 'Current plan',
    requestAction: 'I want this plan',
    inheritsFrom: ({ planName }) => `Everything in ${planName}, plus:`,
    highlightsHeading: 'Includes:',
    moreIncluded: ({ count }) => `+ ${String(count)} more features`,
  },
  comparisonTable: {
    open: 'Compare every feature',
    close: 'Hide the comparison',
    featureColumn: 'Feature',
    included: 'Included',
    excluded: 'Not included',
  },
  upsell: {
    reasons: {
      'not-entitled': {
        title: 'Not included in your plan',
        body: 'Your current plan does not include this feature.',
      },
      'quota-exceeded': {
        title: 'Plan limit reached',
        body: 'You have used all of the allowance your plan includes for this feature.',
      },
      restricted: {
        title: 'Payment outstanding',
        body: 'There is an outstanding payment on the subscription, so this feature is temporarily unavailable. Settle the payment to use it again.',
      },
      suspended: {
        title: 'Subscription suspended',
        body: 'The subscription is suspended and this feature is unavailable. Reinstate the subscription or contact our support team.',
      },
      'disabled-by-tenant': {
        title: 'Feature switched off',
        body: 'This feature is switched off in your settings — it is not a question of plan.',
      },
    },
    askAdmin: 'Ask whoever administers the account to request the plan change.',
    requestReceived: ({ planName }) =>
      planName === null
        ? 'We have your plan-change request. We will be in touch to arrange the details.'
        : `We have your request for the ${planName} plan. We will be in touch to arrange the details.`,
    requestAction: 'I want this plan',
    openSwitch: ({ label }) => `Open ${label}`,
    quotaUsage: ({ used, limit }) => `You are using ${used} of ${limit}.`,
    planPitch: { prefix: 'Available on the ', suffix: ' plan.' },
    allPlansLink: 'See every plan',
  },
  pageLock: {
    reasons: {
      'not-entitled': {
        title: 'Not included in your plan',
        body: 'Your current plan does not include this area. Look at the plan options to unlock it.',
      },
      'quota-exceeded': {
        title: 'Plan limit reached',
        body: 'You have used all of the allowance your plan includes for this feature.',
      },
      restricted: {
        title: 'Payment outstanding',
        body: 'There is an outstanding payment on the subscription, so this area is temporarily unavailable.',
      },
      suspended: {
        title: 'Subscription suspended',
        body: 'The subscription is suspended and this area is unavailable.',
      },
      // Never reached (disabled-by-tenant passes through to the page) —
      // present because the record is total over UpsellReason on purpose.
      'disabled-by-tenant': {
        title: 'Feature switched off',
        body: 'This feature is switched off in your settings.',
      },
    },
    learnMore: 'Learn more',
  },
};
