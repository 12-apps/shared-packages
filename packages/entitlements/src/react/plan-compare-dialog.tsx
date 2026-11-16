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
import type { JSX } from 'react';

import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Dialog, DialogActions, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { useTheme } from '@12-apps/ui/mui/styles';
import { useMediaQuery } from '@12-apps/ui/mui/useMediaQuery';
import { Text } from '@12-apps/ui/typography/Text';

import type { CompareOfferMode, ComparisonRowRequest, ComparisonTier } from '../plan-wire';
import {
  buildMatrix,
  buildRowsMatrix,
  keysOfRows,
  selectComparisonRows,
  type MatrixSection,
} from './comparison-rows';
import { createPlanApi, useRead } from './plan-api';
import { EachPlanActions } from './plan-compare-each';
import {
  compareOffer,
  compareOffers,
  CompareMatrixView,
  useMeasuredWidth,
  type CompareOffer,
  type CompareOffers,
} from './plan-compare-layout';
import { PlanPitchLine, UpgradeCta } from './upgrade-cta';
import { raiseUpsell } from './upsell-channel';
import type { ResolvedWebConfig } from './web-config';

/** What a screen hands the comparison. */
export interface PlanCompareRequest {
  /**
   * The rows to compare, by {@link ComparisonLine.key}, worded by the host's
   * plan catalogue. Keys no line carries are ignored; when none matches, the
   * dialog says so rather than opening blank. Ignored when `rows` is given.
   */
  keys?: readonly string[] | undefined;
  /**
   * The screen's OWN rows, worded in its own copy: each names the line that
   * decides its marks (`key`) and the `label` it shows. A key may repeat, one
   * entitlement gating several rows. Shown in the screen's order. Wins over
   * `keys`.
   */
  rows?: readonly ComparisonRowRequest[] | undefined;
  /** The dialog's title, in the screen's words. Default: the copy pack's. */
  title?: string | undefined;
  /**
   * What the footer offers. `'cheapest'` (default): one ask, for the tier
   * `plan` names or else the cheapest upgrade covering every row. `'each'`:
   * one "Conhecer o <plano>" per upgrade tier on sale, each linking the
   * plans page at that tier; `plan` is then ignored. Without a `plansPath`
   * there is nothing to link, so `'each'` falls back to `'cheapest'`.
   */
  offer?: CompareOfferMode | undefined;
  /**
   * The tier to offer. Omitted or null: the cheapest upgrade tier that
   * includes EVERY compared row. A tier that is not an upgrade (the tenant's
   * own, or a cheaper one) offers nothing.
   */
  plan?: string | null;
  /** The feature that prompted the ask, filed beside the request. */
  feature?: string;
}

export interface PlanCompareProps extends PlanCompareRequest {
  open: boolean;
  onClose: () => void;
}

/** The all-plans link, with a 40 px hit area (a 16 px line of text is not a target). */
function AllPlansLink({
  config,
  onClose,
}: {
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element | null {
  if (config.plansPath === null) return null;
  const Link = config.LinkComponent;
  return (
    <Box
      sx={{ '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 40 } }}
      data-testid="plan-compare-all-plans-target"
    >
      <Text as="span" size="sm">
        <Link to={config.plansPath} onClick={onClose} data-testid="plan-compare-all-plans">
          {config.copy.upsell.allPlansLink}
        </Link>
      </Text>
    </Box>
  );
}

/** The one ask: for the offered tier, then the all-plans link. */
function SingleAskFooter({
  offer,
  feature,
  config,
  onClose,
}: {
  offer: CompareOffer;
  feature: string | undefined;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element {
  const offered = offer.tier;
  const requiredPlan = offered?.key ?? null;
  const target = feature === undefined ? { requiredPlan } : { requiredPlan, feature };
  return (
    <Stack spacing={1} sx={{ width: '100%' }} data-testid="plan-compare-footer">
      {offer.covered ? (
        <Text as="div" data-testid="plan-compare-already-included">
          {config.copy.planCompare.alreadyIncluded}
        </Text>
      ) : null}
      <PlanPitchLine planName={offered?.name ?? null} config={config} />
      <UpgradeCta target={target} planName={offered?.name ?? null} config={config} />
      <AllPlansLink config={config} onClose={onClose} />
    </Stack>
  );
}

function CompareFooter({
  offer,
  each,
  feature,
  config,
  onClose,
}: {
  offer: CompareOffer;
  each: CompareOffers | null;
  feature: string | undefined;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element {
  if (each !== null && config.plansPath !== null && each.tiers.length > 0) {
    return (
      <EachPlanActions
        offers={each}
        plansPath={config.plansPath}
        config={config}
        onClose={onClose}
      />
    );
  }
  return <SingleAskFooter offer={offer} feature={feature} config={config} onClose={onClose} />;
}

/** The matrix rows: the screen's own, or the payload's lines it named by key. */
function matrixFor(
  tiers: ComparisonTier[],
  request: PlanCompareRequest,
): { selected: ComparisonTier[]; sections: MatrixSection[] } {
  if (request.rows !== undefined) {
    const selected = selectComparisonRows(tiers, keysOfRows(request.rows));
    return { selected, sections: buildRowsMatrix(selected, request.rows) };
  }
  const selected = selectComparisonRows(tiers, request.keys ?? []);
  return { selected, sections: buildMatrix(selected) };
}

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
  request: PlanCompareRequest;
  config: ResolvedWebConfig;
  dense: boolean;
  onClose: () => void;
}): JSX.Element {
  const [measureRef, width] = useMeasuredWidth();
  const { selected, sections } = matrixFor(tiers, request);
  const rowCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const offer = compareOffer(
    selected,
    rowCount,
    request.plan,
    request.rows === undefined ? undefined : sections,
  );
  const each = request.offer === 'each' ? compareOffers(selected, rowCount, sections) : null;
  const copy = config.copy;
  // Under `each` no tier is THE recommendation: the actions below name them all.
  const badges = {
    currentLabel: copy.planCompare.currentBadge,
    offeredKey: each !== null && config.plansPath !== null ? null : offer.tier?.key ?? null,
    offeredLabel: copy.planCompare.offeredBadge,
  };
  return (
    <>
      <DialogContent dense={dense}>
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
  request: PlanCompareRequest;
  config: ResolvedWebConfig;
  dense: boolean;
  onClose: () => void;
}): JSX.Element {
  const planRead = useRead(() =>
    createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed).getPlan(),
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
          message={planRead.error?.message ?? ''}
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
function requestKey(request: PlanCompareRequest): string {
  return JSON.stringify([
    request.keys ?? null,
    request.rows ?? null,
    request.title ?? null,
    request.offer ?? null,
    request.plan ?? null,
    request.feature ?? null,
  ]);
}

/** The screen's title, or the pack's when none (or only blanks) was given. */
function titleOf(requested: string | undefined, fallback: string): string {
  return requested !== undefined && requested.trim() !== '' ? requested : fallback;
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
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  if (!open) return null;
  return (
    <Dialog
      open
      size="sm"
      variant={phone ? 'bottom-sheet' : 'default'}
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
export function openPlanCompare(request: PlanCompareRequest & { feature: string }): void {
  raiseUpsell({
    feature: request.feature,
    requiredPlan: request.plan ?? null,
    reason: 'not-entitled',
    compareKeys: request.rows === undefined ? (request.keys ?? []) : keysOfRows(request.rows),
    ...(request.title === undefined ? {} : { compareTitle: request.title }),
    ...(request.rows === undefined ? {} : { compareRows: request.rows }),
    ...(request.offer === undefined ? {} : { compareOffer: request.offer }),
  });
}
