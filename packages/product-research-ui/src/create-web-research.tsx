/**
 * The one thing this package exposes to a frontend HOST as a unit (the
 * `createWeb*` convention every sibling already follows).
 *
 * Before this, a host wired the research surface by importing two screen
 * components and threading the SAME `ResearchApiClient` — and, on the run
 * screen, the same realtime channel — into each of them by hand, at every
 * call site, memoised correctly at every call site. That is the port, not
 * the host's business: `ResearchApiClient` is one object per tenant, and the
 * channel's own contract requires a referentially stable value for the life
 * of the screen (it is used as a hook). Binding both once, here, is what the
 * memoisation rule stops being a comment.
 *
 * ## WHAT STAYS A PROP, and why
 *
 * **`messages`.** Every string these screens render follows the READER's
 * locale, which a host resolves per render (`useLocaleCopy`). Binding the
 * pack at factory time would pin the whole surface to whichever language was
 * in effect when the host built it, and the symptom — a language switch that
 * changes the chrome and leaves the screens behind — is exactly the "frozen
 * at boot" axis the estate's i18n guidance separates from copy that follows
 * the reader. So the words stay a per-render prop.
 *
 * **Navigation.** `onOpenRequest`, `onViewAllRequests` and `onRepeatRequest`
 * are the host's router and the host's permission gate (repeating is a
 * WRITE, so a read-only actor simply never gets the callback). A package
 * that guessed at them would be wrong for every host but the first.
 */

import type { JSX } from 'react';

import type { ResearchApiClient } from './client';
import { ResearchHomeScreen, type ResearchHomeScreenProps } from './research-home-screen';
import { ResearchRunScreen, type ResearchRunScreenProps } from './research-run-screen';
import type { UseResearchRunChannel } from './run-channel';

/** What a host binds ONCE: the port, and the optional realtime seam. */
export interface ResearchWebConfig {
  /**
   * The host's implementation of the research API — its transport, its
   * tenancy, its error shapes. One per tenant; this surface never builds one.
   */
  client: ResearchApiClient;
  /**
   * Host-injected realtime subscription for per-source streaming. Omit it
   * and the run screen polls exactly as before. Bound here rather than
   * passed per render because the screen uses it AS A HOOK, so it must be
   * referentially stable — the constraint a host previously carried as a
   * `useMemo` and a comment at each call site.
   */
  runChannel?: UseResearchRunChannel;
}

/** The home screen's remaining props once the port is bound. */
export type BoundResearchHomeProps = Omit<ResearchHomeScreenProps, 'client'>;

/** The run screen's remaining props once the port and channel are bound. */
export type BoundResearchRunProps = Omit<ResearchRunScreenProps, 'client' | 'runChannel'>;

/**
 * The bound surface. Members are component TYPES, so a host must hold the
 * object across renders — the consumer's binder does that once per adoption,
 * which is the whole reason the contract names this convention.
 */
export interface ResearchSurface {
  /** Search form + history: the buyer's entry point. */
  home: (props: BoundResearchHomeProps) => JSX.Element;
  /** One research, live: per-source status, then the ranked offers. */
  run: (props: BoundResearchRunProps) => JSX.Element;
}

/** Build the research surface for a host. */
export function createWebResearch(config: ResearchWebConfig): ResearchSurface {
  const { client, runChannel } = config;
  return {
    home: (props) => <ResearchHomeScreen {...props} client={client} />,
    run: (props) => <ResearchRunScreen {...props} client={client} runChannel={runChannel} />,
  };
}
