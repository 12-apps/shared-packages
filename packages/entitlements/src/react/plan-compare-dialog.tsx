/**
 * The per-screen plan comparison (FUT-5062): a popup that sets ONE screen's
 * features side by side across the tiers on sale, marks the tenant's own, and
 * ends on the same ask the upsell prompt makes.
 *
 * A plan-locked screen knows which rows it is about — a chat card is about
 * its three chat lines, not the thirty the plan page holds — so it names them
 * by {@link ComparisonLine.key} and this cuts the payload the plan page
 * already reads down to those rows. Same payload, same marks, and the table
 * is the plan page's own `ComparisonMatrix`: the dialog cannot disagree with
 * the plan page about what a tier includes.
 *
 * ## Opening it
 *
 * - `entitlements.PlanCompare` — a controlled component the host renders
 *   (`open`, `onClose`, `keys`).
 * - `openPlanCompare({ feature, keys | rows, plan, title, offer })` — from anywhere, through the
 *   upsell channel: the prompt host already mounted in the layout opens this
 *   dialog for a plan-gap prompt that carries `compareKeys`.
 *
 * ## Fitting a phone
 *
 * Below the theme's `sm` breakpoint the CHROME is the library's inset bottom
 * sheet with dense padding. The matrix's layout is chosen separately, by the
 * width it measured (`plan-compare-layout.tsx`): a table where it fits,
 * stacked rows where it does not. The footer — the plan line and the ask —
 * sits in the dialog's actions slot, pinned under the scrolling rows, so the
 * one action is on screen at 320 px without a scroll.
 */
import type { JSX, ReactNode } from "react";

import { ErrorState } from "@12-apps/ui/data-display/ErrorState";
import { LoadingState } from "@12-apps/ui/data-display/LoadingState";
import {
  Dialog,
  DialogActions,
  DialogContent,
} from "@12-apps/ui/feedback/Dialog";
import { Box } from "@12-apps/ui/mui/Box";
import { useTheme } from "@12-apps/ui/mui/styles";
import { useMediaQuery } from "@12-apps/ui/mui/useMediaQuery";
import { Text } from "@12-apps/ui/typography/Text";

import type {
  CompareOfferMode,
  ComparisonRowRequest,
  ComparisonTier,
} from "../plan-wire";
import { keysOfRows, matrixForRequest } from "./comparison-rows";
import { createPlanApi, useRead } from "./plan-api";
import { CompareFooter } from "./plan-compare-footer";
import { CompareFootnote, CompareIntro } from "./plan-compare-intro";
import {
  compareOffer,
  compareOffers,
  CompareMatrixView,
  useMeasuredWidth,
} from "./plan-compare-layout";
import { raiseUpsell } from "./upsell-channel";
import type { ResolvedWebConfig } from "./web-config";

/** What every request carries, whichever way it names its rows. */
interface PlanCompareBaseRequest {
  /**
   * The tier to offer. Omitted or null: the cheapest upgrade tier that
   * includes EVERY compared row. A tier that is not an upgrade (the tenant's
   * own, or a cheaper one) offers nothing.
   */
  plan?: string | null;
  /** The feature that prompted the ask, filed beside the request. */
  feature?: string;
  /** The dialog's title, in the screen's words. Default: the copy pack's. */
  title?: string | undefined;
  /** A sentence under the title, above the table, in the screen's words. */
  subtitle?: string | undefined;
  /** A note under the table, in the screen's words. */
  footnote?: string | undefined;
  /**
   * A picture beside the subtitle, above the table. The screen draws it (the
   * package names no brand artwork); it is decoration unless the node says
   * otherwise, so give it its own accessible name if it carries meaning.
   */
  illustration?: ReactNode;
  /**
   * What the footer offers. `'cheapest'` (default): one ask, for the tier
   * `plan` names or else the cheapest upgrade covering every row. `'each'`:
   * one "Conhecer o <plano>" per upgrade tier on sale, each linking the
   * plans page at that tier; `plan` is then ignored. Without a `plansPath`
   * there is nothing to link, so `'each'` falls back to `'cheapest'`.
   */
  offer?: CompareOfferMode | undefined;
}

/**
 * What a screen hands the comparison: the rows by `keys`, worded by the
 * host's plan catalogue, OR its own `rows`, worded in its own copy. One of
 * the two is required.
 */
export type PlanCompareRequest = PlanCompareBaseRequest &
  (
    | {
        /**
         * The rows to compare, by {@link ComparisonLine.key}. Keys no line
         * carries are ignored; when none matches, the dialog says so rather
         * than opening blank.
         */
        keys: readonly string[];
        rows?: undefined;
      }
    | {
        /**
         * The screen's OWN rows: each names the line that decides its marks
         * (`key`) and the `label` it shows. A key may repeat, one entitlement
         * gating several rows. Shown in the screen's order.
         */
        rows: readonly ComparisonRowRequest[];
        keys?: undefined;
      }
  );

/**
 * The controlled component's props. Looser than {@link PlanCompareRequest} on
 * purpose: a component is rendered from state, with props merged from several
 * places, and a union does not survive a spread. `keys` or `rows` is still what
 * it reads (rows win; neither shows the empty sentence); `openPlanCompare`,
 * the call a screen writes by hand, is the strict one.
 */
export interface PlanCompareProps extends PlanCompareBaseRequest {
  open: boolean;
  onClose: () => void;
  keys?: readonly string[] | undefined;
  rows?: readonly ComparisonRowRequest[] | undefined;
}

/** What the dialog reads: either way of naming rows, neither required here. */
type PlanCompareRead = Omit<PlanCompareProps, "open" | "onClose">;

/**
 * The loaded body, as the dialog's two slots: the rows (or their empty
 * sentence) scroll in the content, and the footer is pinned in the actions.
 */
function PlanCompareBody({
  tiers,
  request,
  config,
  dense,
  onClose,
}: {
  tiers: ComparisonTier[];
  request: PlanCompareRead;
  config: ResolvedWebConfig;
  dense: boolean;
  onClose: () => void;
}): JSX.Element {
  const [measureRef, width] = useMeasuredWidth();
  const { selected, sections } = matrixForRequest(tiers, request);
  const rowCount = sections.reduce(
    (sum, section) => sum + section.rows.length,
    0,
  );
  const offer = compareOffer(
    selected,
    rowCount,
    request.plan,
    request.rows === undefined ? undefined : sections,
  );
  const each =
    request.offer === "each"
      ? compareOffers(selected, rowCount, sections)
      : null;
  const copy = config.copy;
  // Under `each` no tier is THE recommendation: the actions below name them all.
  const badges = {
    currentLabel: copy.planCompare.currentBadge,
    offeredKey:
      each !== null && config.plansPath !== null
        ? null
        : (offer.tier?.key ?? null),
    offeredLabel: copy.planCompare.offeredBadge,
  };
  return (
    <>
      <DialogContent dense={dense}>
        <CompareIntro
          subtitle={request.subtitle}
          illustration={request.illustration}
          gap={dense ? 1 : 2}
        />
        <Box ref={measureRef} data-testid="plan-compare">
          {rowCount === 0 ? (
            <Text as="div" color="secondary" data-testid="plan-compare-empty">
              {copy.planCompare.empty}
            </Text>
          ) : (
            <CompareMatrixView
              tiers={selected}
              sections={sections}
              copy={copy.comparisonTable}
              badges={badges}
              width={width}
            />
          )}
        </Box>
        <CompareFootnote footnote={request.footnote} />
      </DialogContent>
      <DialogActions alignment="left">
        <CompareFooter
          offer={offer}
          each={each}
          feature={request.feature}
          config={config}
          onClose={onClose}
        />
      </DialogActions>
    </>
  );
}

function PlanCompareLoader({
  request,
  config,
  dense,
  onClose,
}: {
  request: PlanCompareRead;
  config: ResolvedWebConfig;
  dense: boolean;
  onClose: () => void;
}): JSX.Element {
  const planRead = useRead(() =>
    createPlanApi(
      config.apiBase,
      config.fetchImpl,
      config.copy.requestFailed,
    ).getPlan(),
  );
  if (planRead.pending) {
    return (
      <DialogContent dense={dense}>
        <LoadingState dataTestId="plan-compare-loading" />
      </DialogContent>
    );
  }
  if (planRead.error !== null || planRead.data === null) {
    return (
      <DialogContent dense={dense}>
        <ErrorState
          title={config.copy.planPage.loadFailedTitle}
          message={planRead.error?.message ?? ""}
          onRetry={planRead.reload}
          retryLabel={config.copy.planCompare.retry}
          dataTestId="plan-compare-error"
        />
      </DialogContent>
    );
  }
  return (
    <PlanCompareBody
      tiers={planRead.data.plan.comparison}
      request={request}
      config={config}
      dense={dense}
      onClose={onClose}
    />
  );
}

/** One identity per request: a new request is a new dialog, not a reused "sent" state. */
function requestKey(request: PlanCompareRead): string {
  return JSON.stringify([
    request.keys ?? null,
    request.rows ?? null,
    request.title ?? null,
    request.subtitle ?? null,
    request.footnote ?? null,
    request.offer ?? null,
    request.plan ?? null,
    request.feature ?? null,
  ]);
}

/** The screen's title, or the pack's when none (or only blanks) was given. */
function titleOf(requested: string | undefined, fallback: string): string {
  return requested !== undefined && requested.trim() !== ""
    ? requested
    : fallback;
}

/**
 * The dialog. Reads the plan payload only while open — the loader unmounts
 * with it, so every opening shows the current answer.
 */
export function PlanCompareDialog({
  open,
  onClose,
  config,
  ...request
}: PlanCompareProps & { config: ResolvedWebConfig }): JSX.Element | null {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down("sm"));
  if (!open) return null;
  return (
    <Dialog
      open
      size="sm"
      variant={phone ? "bottom-sheet" : "default"}
      title={titleOf(request.title, config.copy.planCompare.title)}
      closeLabel={config.copy.planCompare.closeLabel}
      onClose={onClose}
      dataTestId="plan-compare-modal"
    >
      <PlanCompareLoader
        key={requestKey(request)}
        request={request}
        config={config}
        dense={phone}
        onClose={onClose}
      />
    </Dialog>
  );
}

/**
 * Open the comparison from anywhere — an event handler, a 402 interceptor —
 * through the upsell channel. The prompt host mounted in the layout renders
 * it. No-op until a host subscribes.
 */
export function openPlanCompare(
  request: PlanCompareRequest & { feature: string },
): void {
  raiseUpsell({
    feature: request.feature,
    requiredPlan: request.plan ?? null,
    reason: "not-entitled",
    compareKeys:
      request.rows === undefined
        ? (request.keys ?? [])
        : keysOfRows(request.rows),
    ...(request.title === undefined ? {} : { compareTitle: request.title }),
    ...(request.rows === undefined ? {} : { compareRows: request.rows }),
    ...(request.offer === undefined ? {} : { compareOffer: request.offer }),
    ...(request.subtitle === undefined
      ? {}
      : { compareSubtitle: request.subtitle }),
    ...(request.footnote === undefined
      ? {}
      : { compareFootnote: request.footnote }),
    ...(request.illustration === undefined
      ? {}
      : { compareIllustration: request.illustration }),
  });
}
