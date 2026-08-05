'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  MaskedProviderConfig,
  MerchantSettingsView,
  ProviderDescriptor,
  ProviderSetupGuide as Guide,
} from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { useCheckoutAck } from './checkout-ack';
import { CHECKOUT_CONFIRM_ACTION } from './SetupGuideSection';

/**
 * Everything the settings screen KNOWS, separated from what it draws.
 *
 * The component had accumulated five hooks and three derivations above its
 * early returns — the position where a React component is least readable,
 * because none of it can be moved and all of it has to be understood before
 * the first line of markup. Split out, that file is about layout and this one
 * is about state.
 */

/**
 * Fetch the selected provider's walkthrough.
 *
 * `progressKey` exists because a guide is no longer a constant per provider:
 * the server decides which step to show from what the store has already done,
 * so the walkthrough goes stale the moment the connection changes. Keyed on
 * the provider alone, saving a credential left the owner reading the step they
 * had just completed — the screen said "informe sua InfiniteTag" underneath
 * the tag they had saved a second earlier.
 *
 * A derived STRING rather than the config object: the settings view is
 * replaced on every reload, so an object dependency would refetch the guide
 * after any action at all, including ones that cannot change it.
 */
export function useSetupGuide(
  client: PaymentsSettingsClient,
  provider: string | null,
  progressKey: string,
): { guide: Guide | null; loaded: boolean } {
  const [state, setState] = useState<{ guide: Guide | null; loaded: boolean }>({
    guide: null,
    loaded: false,
  });
  useEffect(() => {
    setState({ guide: null, loaded: false });
    if (!provider) return;
    client
      .getSetupGuide(provider)
      // `loaded` is not cosmetic. "No guide yet" and "this provider ships no
      // guide" are the same `null`, and the difference decides whether a REAL
      // payment button is on screen — so for one frame after every load, a
      // store mid-setup was offered the charge before anything knew which step
      // it was on.
      .then((guide) => setState({ guide, loaded: true }))
      .catch(() => setState({ guide: null, loaded: true }));
  }, [client, provider, progressKey]);
  return state;
}

/**
 * The facts a guide branches on, flattened to a comparable string: which
 * credential fields are filled in the active environment, whether the probe
 * passed, and whether a charge has proved it.
 */
export function progressKeyOf(config: MaskedProviderConfig | null): string {
  if (!config) return 'none';
  const configured = Object.entries(config.environments[config.environment] ?? {})
    .filter(([, field]) => field.configured)
    .map(([key]) => key)
    .sort()
    .join(',');
  return `${config.environment}|${config.status}|${config.chargeVerifiedAt ?? ''}|${configured}`;
}

/**
 * Is the walkthrough still waiting on the owner to confirm something?
 *
 * The one input to `blocked`. It lives with the guide rather than inside the
 * activation step because the guide is what knows a confirmable section is
 * still on screen; the step only knows about charges.
 */
export function guideAwaitsConfirmation(
  guide: Guide | null,
  confirmed: boolean,
  loaded: boolean,
): boolean {
  if (confirmed) return false;
  // Withheld until we know. Erring towards blocked costs at most a moment's
  // wait on a button; erring the other way puts "Pagar e ativar" in front of an
  // owner whose setup we have not read yet, and that one is paid for in money.
  if (!loaded) return true;
  if (!guide) return false;
  return guide.sections.some((section) =>
    section.steps.some((step) => step.action === CHECKOUT_CONFIRM_ACTION),
  );
}

/**
 * Has the store settled the setup step that only it can see?
 *
 * Two sources, in order of authority. A charge that LANDED proves the
 * provider-side switch is on far better than any answer could, so a store that
 * reconnects from a machine holding no stored confirmation is never sent back
 * through step 2. Failing that, the owner's own word — scoped to this client's
 * tenant-specific base URL, so an owner who runs two stores answers for each.
 */
export function useSetupConfirmation(
  client: PaymentsSettingsClient,
  active: ProviderDescriptor | null,
  config: MaskedProviderConfig | null,
): { confirmed: boolean; confirm: () => void; withdraw: () => void } {
  const ack = useCheckoutAck(client.baseUrl, active ? active.name : null);
  const proven = Boolean(config?.chargeVerifiedAt);
  return { ...ack, confirmed: proven ? true : ack.confirmed };
}

/**
 * The provider the owner has open, and the config row that belongs to it.
 *
 * One hook rather than two `useMemo`s inline, because both have to be resolved
 * BEFORE the loading and error returns — the guide hook depends on them — and
 * that is exactly the position where a component accumulates the branches that
 * make it unreadable.
 *
 * `selected` may be the provider's NAME or its `urlSlug` — a controlled host
 * stores the selection in a path segment, and the segment is the adapter's URL
 * spelling. The raw name stays a working alias so a link built before the
 * adapter declared a slug does not 404.
 */
export function useOpenProvider(
  view: MerchantSettingsView | null,
  selected: string | null,
): { active: ProviderDescriptor | null; activeConfig: MaskedProviderConfig | null } {
  // Nothing is open until the owner picks: the landing view is the list of
  // providers, not one arbitrary provider's configuration.
  const active = useMemo(() => {
    if (!view || !selected) return null;
    return view.providers.find((p) => p.name === selected || p.urlSlug === selected) ?? null;
  }, [view, selected]);

  // A stored connection is what makes the manual walkthrough steps redundant —
  // and, since the guide branches on it, what decides which step is shown.
  const activeConfig = useMemo(() => {
    if (!view || !active) return null;
    return view.configs.find((c) => c.provider === active.name) ?? null;
  }, [view, active]);

  return { active, activeConfig };
}

/**
 * How a host is asked to move its selection. `options.replace` marks a
 * CORRECTION rather than a navigation: the host should rewrite its current
 * history entry (react-router's `replace`), so Voltar never revisits the
 * spelling being corrected.
 */
export type ProviderChangeHandler = (
  provider: string | null,
  options?: { replace?: boolean },
) => void;

/**
 * Ask the HOST to respell its path segment once the catalog can (FUT-557).
 *
 * The OAuth callback hands the host a raw provider NAME (`?connected=`), and a
 * controlled host writes it into the URL verbatim — it holds no slug map, on
 * purpose. The alias already resolves, so the SCREEN is right either way; what
 * stays wrong is the ADDRESS BAR, which is exactly what a reload or a shared
 * link uses. Once the view knows the provider's declared spelling, hand the
 * canonical slug back — with `replace`, so the alias spelling never becomes a
 * history entry of its own.
 *
 * Controlled hosts only: with internal selection there is no URL to fix, and
 * `controlled === undefined` is the one test for that (see
 * {@link useSelectedProvider}).
 */
export function useCanonicalProviderSegment(
  controlled: string | null | undefined,
  active: ProviderDescriptor | null,
  onProviderChange: ProviderChangeHandler | undefined,
): void {
  useEffect(() => {
    if (controlled === undefined || controlled === null) return;
    if (!active?.urlSlug || active.urlSlug === controlled) return;
    onProviderChange?.(active.urlSlug, { replace: true });
  }, [controlled, active, onProviderChange]);
}

export function useSettingsState(client: PaymentsSettingsClient) {
  const [view, setView] = useState<MerchantSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setView(await client.getSettings());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { view, error, reload };
}

/**
 * Which provider is open, and the once-only handover from the host.
 *
 * Seeding `useState` with `initialProvider` is not enough: the host reads the
 * provider from the OAuth callback's query string in an EFFECT, so on first
 * render it is still null — and `useState` keeps that null forever. The owner
 * therefore landed on the list after authorizing, which is the bug this fixed
 * twice.
 *
 * Applied ONCE. The host holds the outcome for the page's lifetime, so
 * re-applying it would make "Voltar aos provedores" bounce straight back into
 * the provider and trap the owner on one screen.
 *
 * None of that applies when the host is CONTROLLING the selection: there is no
 * handover to make, because the host's value already is the answer on every
 * render. `controlled === undefined` is the only test for that — `null` is a
 * controlled host legitimately saying "the list", and treating it as absent
 * would strand the owner in whichever provider they last opened.
 */
export function useSelectedProvider(
  initialProvider: string | null,
  controlled: string | null | undefined,
  onProviderChange: ProviderChangeHandler | undefined,
) {
  const isControlled = controlled !== undefined;
  const [internal, setInternal] = useState<string | null>(initialProvider);
  const honoredInitial = useRef(false);

  useEffect(() => {
    if (isControlled || honoredInitial.current || !initialProvider) return;
    honoredInitial.current = true;
    setInternal(initialProvider);
  }, [initialProvider, isControlled]);

  const setSelected = useCallback(
    (provider: string | null) => {
      if (!isControlled) setInternal(provider);
      onProviderChange?.(provider);
    },
    [isControlled, onProviderChange],
  );

  return { selected: isControlled ? controlled : internal, setSelected };
}
