import type { NotificationLogger } from '../types';

import { createCapsGate, type CapsGate } from './caps';
import { createConsentEngine, resolveConsentConfig, type ConsentEngine } from './consent';
import type { NotificationsServerConfig } from './create-api-notifications';
import {
  DEFAULT_MAX_DELIVERY_ATTEMPTS,
  type NotificationConsentGate,
  type NotificationDispatchDeps,
} from './dispatch';
import type { NotificationRouterDeps } from './router';
import type { TransportRegistry } from './transports/registry';

/**
 * What one `createApiNotifications` mount hands its router: the stores, the
 * host seams, and the paid-channel policy (consent, the guest gate, the caps).
 */

/** Drop the keys the host left unset, so an absent seam stays absent. */
export function present<T extends object>(entries: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** The router's deps: the stores, the host seams, and the paid-channel policy. */
export function routerDepsOf(
  config: NotificationsServerConfig,
  parts: Pick<
    NotificationRouterDeps,
    'generators' | 'transports' | 'preferences' | 'pushSubscriptions' | 'logger'
  >,
  paid: ReturnType<typeof paidPolicy>,
): NotificationRouterDeps {
  const { generators, transports, preferences, pushSubscriptions, logger } = parts;
  return {
    db: config.db,
    generators,
    transports,
    preferences,
    pushSubscriptions,
    contacts: config.contacts,
    logger,
    maxAttempts: config.maxDeliveryAttempts ?? DEFAULT_MAX_DELIVERY_ATTEMPTS,
    // `exactOptionalPropertyTypes` is on, so an absent host seam must be an
    // ABSENT key rather than an explicit `undefined`.
    ...present({
      channelPolicy: config.channelPolicy,
      emitChannelFilter: config.emitChannelFilter,
      scheduleDispatch: config.scheduleDispatch,
      onCommitted: config.onCommitted,
      sideOf: config.sideOf,
      consentGate: paid.gate,
      guestGate: paid.guestGate,
      onRejected: paid.onRejected,
      caps: paid.caps,
    }),
  };
}

/**
 * The paid-channel policy of one mount: the consent engine (when `consent` is
 * configured), the gate it applies (whenever `consent` is configured: the
 * channels in `requireConsent` need a confirmation, and EVERY paid channel
 * stops at an opt-out — a mount that merely collects consent otherwise sends as
 * before), what a provider refusal of a number records, and the caps. Every
 * part is absent unless the host asked for it.
 */
export function paidPolicy(
  config: NotificationsServerConfig,
  transports: TransportRegistry,
  logger: NotificationLogger,
): {
  consent?: ConsentEngine;
  gate?: NotificationConsentGate;
  guestGate?: NotificationDispatchDeps['guestGate'];
  onRejected?: NotificationDispatchDeps['onRejected'];
  caps?: CapsGate;
} {
  const requireConsent = config.requireConsent ?? [];
  const consentConfig = resolveConsentConfig(config.consent, requireConsent);
  const caps = config.caps ? createCapsGate(config.db, config.caps, logger) : null;
  if (!consentConfig) return caps ? { caps } : {};
  const consent = createConsentEngine(
    { db: config.db, contacts: config.contacts, transports, config: consentConfig, caps, logger },
    requireConsent,
  );
  return {
    consent,
    gate: consent.allowed,
    guestGate: consent.allowedForGuest,
    onRejected: ({ deliveryId, ...rejection }) =>
      consent.rejected({ ...rejection, ref: `provider-refusal:${deliveryId}` }),
    ...(caps ? { caps } : {}),
  };
}
