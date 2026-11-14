/**
 * The default upgrade prompt — the single surface every trigger (a page lock,
 * a `<Locked>` upsell, a 402 from the API client) lands on, via the upsell
 * channel.
 *
 * The copy branches on WHY the feature is locked, because only one of the
 * reasons is a sale: a plan gap (or a spent quota) gets the upgrade pitch; a
 * `restricted`/`suspended` account already paid, so it gets settle-up copy
 * and NO plan offer; `disabled-by-tenant` is their own switch, so it points
 * at the settings screen that actually holds that switch (per-feature, via
 * the host's `switchLocation` map) and never mentions money. `requiredPlan`
 * can be null even on a real plan gap — the pitch line renders only when
 * there is a plan to name, never "Disponível no plano " with a dangling
 * blank. A plan-gap prompt that carries `compareKeys` opens the per-screen
 * comparison (`PlanCompareDialog`) instead.
 *
 * PRICING copy stays out: the prompt names the tier and files the lead; what
 * a tier costs is the plan screen's business, where the numbers arrive from
 * the host's billing.
 */
import { useEffect, useState, type JSX } from 'react';

import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { UpsellPrompt, UpsellReason } from '../plan-wire';
import { PlanCompareDialog } from './plan-compare-dialog';
import { createPlanApi, useRead } from './plan-api';
import { PlanPitchLine, UpgradeCta } from './upgrade-cta';
import { subscribeToUpsell } from './upsell-channel';
import type { ResolvedWebConfig } from './web-config';

/** The two reasons an upgrade honestly fixes. */
function isUpgradeable(reason: UpsellReason): boolean {
  return reason === 'not-entitled' || reason === 'quota-exceeded';
}

/** The non-sale destination: their own config switch, named per feature. */
function LockedElsewhereLink({
  reason,
  feature,
  config,
  onClose,
}: {
  reason: UpsellReason;
  feature: string;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element | null {
  if (reason !== 'disabled-by-tenant') return null;
  // Per-feature, not a fixed link: the switches live on different screens,
  // and a fixed destination opens a page with no such switch on it.
  const location = config.switchLocation(feature);
  if (location === null) return null;
  const Link = config.LinkComponent;
  return (
    <Link to={location.path} onClick={onClose} data-testid="upsell-config-link">
      {config.copy.upsell.openSwitch({ label: location.label })}
    </Link>
  );
}

function QuotaLine({
  quota,
  config,
}: {
  quota: UpsellPrompt['quota'];
  config: ResolvedWebConfig;
}): JSX.Element | null {
  if (quota === undefined || typeof quota.limit !== 'number') return null;
  return (
    <Text as="div" size="sm" color="secondary" data-testid="upsell-quota">
      {config.copy.upsell.quotaUsage({ used: quota.used, limit: quota.limit })}
    </Text>
  );
}

function UpsellDialogBody({
  prompt,
  config,
  onClose,
}: {
  prompt: UpsellPrompt;
  config: ResolvedWebConfig;
  onClose: () => void;
}): JSX.Element {
  const upgradeable = isUpgradeable(prompt.reason);
  const requiredPlan = upgradeable ? prompt.requiredPlan : null;
  // The comparison names the tier commercially; fetched only while there is a
  // plan to name.
  const planRead = useRead(() =>
    requiredPlan === null
      ? Promise.resolve(null)
      : createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed).getPlan(),
  );
  const planName =
    planRead.data?.plan.comparison.find((tier) => tier.key === requiredPlan)?.name ?? null;
  const Link = config.LinkComponent;

  return (
    <Stack spacing={2}>
      <Text as="div">{config.copy.upsell.reasons[prompt.reason].body}</Text>
      <QuotaLine quota={prompt.quota} config={config} />
      <PlanPitchLine planName={planName} config={config} />
      {upgradeable ? (
        <UpgradeCta target={prompt} planName={planName} config={config} />
      ) : (
        <LockedElsewhereLink
          reason={prompt.reason}
          feature={prompt.feature}
          config={config}
          onClose={onClose}
        />
      )}
      {upgradeable && config.plansPath !== null ? (
        <Link to={config.plansPath} onClick={onClose} data-testid="upsell-planos-link">
          {config.copy.upsell.allPlansLink}
        </Link>
      ) : null}
    </Stack>
  );
}

/**
 * Mounted ONCE inside the app's tenant layout. Subscribes to the upsell
 * channel; a raise from anywhere — sidebar, provider `onUpsell`, a 402
 * interceptor — opens this dialog.
 */
export function UpsellPromptHost({ config }: { config: ResolvedWebConfig }): JSX.Element | null {
  // Each raise is its own dialog: keyed by a counter, so a second raise while
  // one is open starts fresh instead of inheriting a "request sent" state that
  // was about a different plan.
  const [raised, setRaised] = useState<{ prompt: UpsellPrompt; id: number } | null>(null);
  useEffect(
    () =>
      subscribeToUpsell((next) => setRaised((was) => ({ prompt: next, id: (was?.id ?? 0) + 1 }))),
    [],
  );
  if (raised === null) return null;
  const { prompt, id } = raised;
  const close = (): void => {
    setRaised(null);
  };
  // A prompt carrying `compareKeys` is a screen asking to show its own rows
  // side by side. Only a SALE gets the comparison: a restricted, suspended or
  // switched-off feature keeps the plain prompt, whose copy says why no plan
  // fixes it.
  if (prompt.compareKeys !== undefined && isUpgradeable(prompt.reason)) {
    return (
      <PlanCompareDialog
        key={id}
        open
        onClose={close}
        keys={prompt.compareKeys}
        feature={prompt.feature}
        plan={prompt.requiredPlan}
        config={config}
      />
    );
  }
  return (
    <Dialog
      key={id}
      open
      size="sm"
      title={config.copy.upsell.reasons[prompt.reason].title}
      onClose={close}
      dataTestId="upsell-modal"
    >
      <DialogContent>
        <UpsellDialogBody prompt={prompt} config={config} onClose={close} />
      </DialogContent>
    </Dialog>
  );
}
