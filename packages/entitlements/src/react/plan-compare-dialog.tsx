/**
 * The per-screen plan comparison (FUT-5062): a popup that sets ONE screen's
 * features side by side across the tiers on sale, marks the tenant's own, and
 * ends on the same ask the upsell prompt makes.
 *
 * A plan-locked screen knows which rows it is about — a chat card is about
 * its three chat lines, not the thirty the plan page holds — so it names them
 * by {@link ComparisonLine.key} and this cuts the payload the plan page
 * already reads down to those rows. Same payload, same matrix renderer
 * (`ComparisonMatrix`), same marks: the dialog cannot disagree with the plan
 * page about what a tier includes.
 *
 * ## Opening it
 *
 * - `entitlements.PlanCompare` — a controlled component the host renders
 *   (`open`, `onClose`, `keys`).
 * - `openPlanCompare({ feature, keys, plan })` — from anywhere, through the
 *   upsell channel: the prompt host already mounted in the layout opens this
 *   dialog for a plan-gap prompt that carries `compareKeys`.
 *
 * ## Fitting a phone
 *
 * Below the theme's `sm` breakpoint it is the library's inset bottom sheet
 * with dense padding, and the matrix is `compact`: three narrow fixed tier
 * columns and a wrapping label column fit 320 px with no sideways scroll.
 */
import type { JSX } from 'react';

import { ErrorState } from '@12-apps/ui/data-display/ErrorState';
import { LoadingState } from '@12-apps/ui/data-display/LoadingState';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { useTheme } from '@12-apps/ui/mui/styles';
import { useMediaQuery } from '@12-apps/ui/mui/useMediaQuery';
import { Text } from '@12-apps/ui/typography/Text';

import type { ComparisonLine, ComparisonTier } from '../plan-wire';
import { ComparisonMatrix } from './comparison-matrix';
import { buildMatrix, selectComparisonRows } from './comparison-rows';
import { createPlanApi, useRead } from './plan-api';
import { PlanPitchLine, UpgradeCta } from './upgrade-cta';
import { raiseUpsell } from './upsell-channel';
import type { ResolvedWebConfig } from './web-config';

/** What a screen hands the comparison. */
export interface PlanCompareRequest {
  /**
   * The rows to compare, by {@link ComparisonLine.key}. Keys no line carries
   * are ignored; when none matches, the dialog says so rather than opening
   * blank.
   */
  keys: readonly string[];
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

function linesOf(tier: ComparisonTier): ComparisonLine[] {
  return tier.sections.flatMap((section) => section.lines);
}

/**
 * The tier the footer offers, from the already-filtered tiers. `rowCount` is
 * how many rows the matrix shows: a tier that leaves one out does not
 * include "every compared row", however its listed lines read.
 */
export function offeredTier(
  tiers: ComparisonTier[],
  rowCount: number,
  plan: string | null | undefined,
): ComparisonTier | null {
  if (plan !== undefined && plan !== null) {
    return tiers.find((tier) => tier.key === plan && tier.upgrade) ?? null;
  }
  if (rowCount === 0) return null;
  return (
    tiers.find((tier) => {
      const lines = linesOf(tier);
      return tier.upgrade && lines.length === rowCount && lines.every((line) => line.included);
    }) ?? null
  );
}

function CompareFooter({
  offered,
  feature,
  config,
  onClose,
}: {
  offered: ComparisonTier | null;
  feature: string | undefined;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element {
  const Link = config.LinkComponent;
  const requiredPlan = offered?.key ?? null;
  const target = feature === undefined ? { requiredPlan } : { requiredPlan, feature };
  return (
    <Stack spacing={1.5}>
      <PlanPitchLine planName={offered?.name ?? null} config={config} />
      <UpgradeCta target={target} planName={offered?.name ?? null} config={config} />
      {config.plansPath === null ? null : (
        <Text as="div" size="sm">
          <Link to={config.plansPath} onClick={onClose} data-testid="plan-compare-all-plans">
            {config.copy.upsell.allPlansLink}
          </Link>
        </Text>
      )}
    </Stack>
  );
}

/** The loaded body: the matrix (or its empty sentence) and the ask. */
export function PlanCompareBody({
  tiers,
  request,
  config,
  compact,
  onClose,
}: {
  tiers: ComparisonTier[];
  request: PlanCompareRequest;
  config: ResolvedWebConfig;
  compact: boolean;
  onClose: () => void;
}): JSX.Element {
  const selected = selectComparisonRows(tiers, request.keys);
  const sections = buildMatrix(selected);
  const rowCount = sections.reduce((sum, section) => sum + section.rows.length, 0);
  const copy = config.copy;
  return (
    <Stack spacing={2} data-testid="plan-compare">
      {rowCount === 0 ? (
        <Text as="div" color="secondary" data-testid="plan-compare-empty">
          {copy.planCompare.empty}
        </Text>
      ) : (
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <ComparisonMatrix
            tiers={selected}
            sections={sections}
            copy={copy.comparisonTable}
            density={compact ? 'compact' : 'full'}
            currentLabel={copy.planCompare.currentBadge}
            sectionTitles={sections.length > 1}
            dataTestId="plan-compare-table"
          />
        </Box>
      )}
      <CompareFooter
        offered={offeredTier(selected, rowCount, request.plan)}
        feature={request.feature}
        config={config}
        onClose={onClose}
      />
    </Stack>
  );
}

function PlanCompareLoader({
  request,
  config,
  compact,
  onClose,
}: {
  request: PlanCompareRequest;
  config: ResolvedWebConfig;
  compact: boolean;
  onClose: () => void;
}): JSX.Element {
  const planRead = useRead(() =>
    createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed).getPlan(),
  );
  if (planRead.pending) return <LoadingState dataTestId="plan-compare-loading" />;
  if (planRead.error !== null || planRead.data === null) {
    return (
      <ErrorState
        title={config.copy.planPage.loadFailedTitle}
        message={planRead.error?.message ?? ''}
      />
    );
  }
  return (
    <PlanCompareBody
      tiers={planRead.data.plan.comparison}
      request={request}
      config={config}
      compact={compact}
      onClose={onClose}
    />
  );
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
      title={config.copy.planCompare.title}
      closeLabel={config.copy.planCompare.closeLabel}
      onClose={onClose}
      dataTestId="plan-compare-modal"
    >
      <DialogContent dense={phone}>
        <PlanCompareLoader request={request} config={config} compact={phone} onClose={onClose} />
      </DialogContent>
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
    compareKeys: request.keys,
  });
}
