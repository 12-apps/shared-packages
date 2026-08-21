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
 * blank.
 *
 * PRICING copy stays out: the prompt names the tier and files the lead; what
 * a tier costs is the plan screen's business, where the numbers arrive from
 * the host's billing.
 */
import { useEffect, useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Dialog, DialogContent } from '@12-apps/ui/feedback/Dialog';
import { Button } from '@12-apps/ui/form/Button';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { UpsellPrompt, UpsellReason } from '../plan-wire';
import { createPlanApi, useRead } from './plan-api';
import { subscribeToUpsell } from './upsell-channel';
import type { ResolvedWebConfig } from './web-config';

/** The two reasons an upgrade honestly fixes. */
function isUpgradeable(reason: UpsellReason): boolean {
  return reason === 'not-entitled' || reason === 'quota-exceeded';
}

/**
 * The ask-for-the-plan action. Mirrors the plan page's gate: the WRITE requires
 * `plan:request` server-side, so a caller without it gets told which plan
 * unlocks the feature and to talk to whoever holds that permission — never a
 * button that answers 403.
 */
function UpgradeCta({
  prompt,
  planName,
  config,
}: {
  prompt: UpsellPrompt;
  planName: string | null;
  config: ResolvedWebConfig;
}): JSX.Element | null {
  const [state, setState] = useState<{ sent: boolean; pending: boolean; error: Error | null }>({
    sent: false,
    pending: false,
    error: null,
  });
  const copy = config.copy.upsell;
  const { requiredPlan } = prompt;
  if (requiredPlan === null) return null;
  if (!config.canRequestPlanChange) {
    return (
      <Text as="div" size="sm" color="secondary" data-testid="upsell-ask-admin">
        {copy.askAdmin}
      </Text>
    );
  }
  if (state.sent) {
    // Never the raw plan key, not even here: while the commercial name is
    // still loading, `requestReceived` gets null and drops the clause.
    return (
      <Alert severity="info" data-testid="upsell-request-sent">
        {copy.requestReceived({ planName })}
      </Alert>
    );
  }
  const ask = (): void => {
    setState({ sent: false, pending: true, error: null });
    createPlanApi(config.apiBase, config.fetchImpl, config.copy.requestFailed)
      .requestPlanChange({ requestedPlan: requiredPlan, feature: prompt.feature })
      .then(
        () => setState({ sent: true, pending: false, error: null }),
        (error: unknown) =>
          setState({
            sent: false,
            pending: false,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
      );
  };
  return (
    <Stack spacing={1}>
      {state.error === null ? null : (
        <Alert severity="error" data-testid="upsell-request-error">
          {state.error.message}
        </Alert>
      )}
      <Button size="sm" fullWidth disabled={state.pending} data-testid="upsell-cta" onClick={ask}>
        {copy.requestAction}
      </Button>
    </Stack>
  );
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

/**
 * The pitch line — only once the catalog resolves the COMMERCIAL name: the
 * raw plan key must never face a customer, not even as a loading fallback,
 * and a null `requiredPlan` must never leave the pitch dangling around a
 * blank. The name slot is markup, so the sentence ships as prefix + suffix
 * around it, each half carrying its own spacing.
 */
function PlanPitchLine({
  planName,
  config,
}: {
  planName: string | null;
  config: ResolvedWebConfig;
}): JSX.Element | null {
  if (planName === null) return null;
  const { prefix, suffix } = config.copy.upsell.planPitch;
  return (
    <Text as="div" data-testid="upsell-plan-name">
      {prefix}
      <strong>{planName}</strong>
      {suffix}
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
        <UpgradeCta prompt={prompt} planName={planName} config={config} />
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
  const [prompt, setPrompt] = useState<UpsellPrompt | null>(null);
  useEffect(() => subscribeToUpsell(setPrompt), []);
  if (prompt === null) return null;
  const close = (): void => {
    setPrompt(null);
  };
  return (
    <Dialog
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
