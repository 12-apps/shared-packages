/**
 * Every sentence the web surface renders — REQUIRED host config, with NO
 * defaults (the copy-portability doctrine): the plan screen, the pricing
 * cards, the upgrade prompt and the page lock compiled in one product's
 * pt-BR, so every adopter shipped that product's voice with nothing red. A
 * pt-BR host imports {@link PT_BR_ENTITLEMENTS_WEB_COPY} from `./pt-BR`
 * (re-exported at `@12-apps/entitlements/react`) and passes it by hand — one
 * reviewable line, never a silence.
 *
 * Facts travel as ARGUMENTS (a label, a count, a plan's commercial name), so
 * a translation can put them where its own grammar wants them. What does NOT
 * live here: the `reason` codes the copy is keyed by (wire contract, the
 * package's), and every word that arrives in the payload — tier names,
 * pitches, section titles and prices are the host's billing display data,
 * printed as handed.
 */
import type { UpsellReason } from '../plan-wire';

/** A dialog's (or a lock's) two lines for one denial reason. */
export interface ReasonCopy {
  title: string;
  body: string;
}

export interface PlanPageCopy {
  /** The page heading. */
  title: string;
  /** The lead-in — the plan's name renders right after it, emphasized. */
  currentPlanPrefix: string;
  /**
   * Rendered right after the emphasized name; carries the sentence's closing
   * punctuation and, when the host priced the tier, the price beside it.
   */
  currentPlanDetail: (context: { price: string | null }) => string;
  loadFailedTitle: string;
  /** The banner over an OPEN ask — `plan` is the requested plan's key. */
  requestReceived: (context: { plan: string }) => string;
  /** The live-status half: heading, its one-line intro, and the empty state. */
  statusHeading: string;
  statusIntro: string;
  statusEmpty: string;
  /**
   * The status list opens on the rows that NEED ATTENTION — denied, switched
   * off, or over a ceiling — because that is the half a tenant can act on; the
   * rest is one press away. `count` is how many rows the press would add.
   */
  statusShowAll: (context: { count: number }) => string;
  statusShowBlocked: string;
  /** The list's own empty state when nothing needs attention at all. */
  statusNothingBlocked: string;
  /**
   * A quota ceiling beside a row's note. A ZERO ceiling renders neither —
   * "up to 0" is a denial pretending to be a limit, and the note already
   * says the feature is not included.
   */
  ceilingUnlimited: string;
  ceilingUpTo: (context: { limit: number }) => string;
  /** "available on plan X" — always the COMMERCIAL name, never the raw key. */
  availableOn: (context: { planLabel: string }) => string;
  /** The way back to the tenant's own switch — `label` is the host's screen name. */
  openSwitch: (context: { label: string }) => string;
  /** The row's on/off badge. */
  statusBadge: { enabled: string; disabled: string };
  /**
   * The two ways out of the SUMMARY — the plan surface as it appears on a
   * host's account page. `blocked` is how many rows the audit would show,
   * which is the one number worth carrying onto a page that short.
   */
  summaryPlansLink: string;
  summaryFeaturesLink: (context: { blocked: number }) => string;
}

export interface TierCardsCopy {
  /** The tenant's own card. Wins over `recommendedBadge` when both apply. */
  currentBadge: string;
  recommendedBadge: string;
  /** The price slot when the host sent no price for a tier. */
  priceUnpriced: string;
  /** The disabled marker on the tenant's own card. */
  currentAction: string;
  /** The press-to-ask CTA on an upgrade card. */
  requestAction: string;
  /**
   * Over the short list on a card that builds on the tier before it —
   * `planName` is that cheaper tier's COMMERCIAL name, never its key.
   */
  inheritsFrom: (context: { planName: string }) => string;
  /** The same line on the ENTRY tier, which builds on nothing. */
  highlightsHeading: string;
  /**
   * The tail of a trimmed list: how many more lines the full matrix holds for
   * this tier. Rendered only when `count` is positive.
   */
  moreIncluded: (context: { count: number }) => string;
}

/**
 * The full matrix, which the cards deliberately no longer are.
 *
 * A card that printed every line made the four of them ~35 rows tall each and
 * pushed price and CTA under a fold — the comparison a customer came for was
 * the one thing the page could not show. The rows moved here, behind a
 * disclosure, where a label is stated ONCE across all tiers instead of once
 * per card.
 */
export interface ComparisonTableCopy {
  /** The disclosure, closed and open. */
  open: string;
  close: string;
  /** The row-header column's own heading. */
  featureColumn: string;
  /**
   * What the ✓ and the − SAY. A card's mark is decoration beside a label that
   * carries the meaning; a matrix cell has no label of its own, so these are
   * the cell's only reading and are never decorative.
   */
  included: string;
  excluded: string;
}

export interface UpsellHostCopy {
  /**
   * The dialog's title/body per reason. Total over {@link UpsellReason} so a
   * new reason fails typecheck here instead of blanking a dialog at runtime.
   */
  reasons: Record<UpsellReason, ReasonCopy>;
  /** For a caller the write would 403: point at whoever holds the permission. */
  askAdmin: string;
  /**
   * The sent confirmation. `planName` is the tier's COMMERCIAL name, or null
   * while it still loads — the raw key must never fill in, so a null drops
   * the clause rather than naming one.
   */
  requestReceived: (context: { planName: string | null }) => string;
  requestAction: string;
  /** The non-sale destination for `disabled-by-tenant`: their own switch. */
  openSwitch: (context: { label: string }) => string;
  quotaUsage: (context: { used: number; limit: number }) => string;
  /**
   * Around the emphasized plan name: `prefix` before, `suffix` after (the
   * closing punctuation). Each half carries its own spacing.
   */
  planPitch: { prefix: string; suffix: string };
  allPlansLink: string;
}

export interface PageLockCopy {
  /**
   * The in-shell lock's title/body per reason. Total over
   * {@link UpsellReason} even though `disabled-by-tenant` passes through to
   * the page — totality is what keeps a new reason from blanking the lock.
   */
  reasons: Record<UpsellReason, ReasonCopy>;
  /** The button that funnels into the upsell prompt. */
  learnMore: string;
}

export interface EntitlementsWebCopy {
  /**
   * The transport's last-resort failure sentence, when the server answered
   * without a sentence of its own — the one string `plan-api` used to carry.
   */
  requestFailed: (context: { status: number }) => string;
  planPage: PlanPageCopy;
  tierCards: TierCardsCopy;
  comparisonTable: ComparisonTableCopy;
  upsell: UpsellHostCopy;
  pageLock: PageLockCopy;
}
