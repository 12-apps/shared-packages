import type { NotificationChannel, NotificationTransport } from '../../types';

import type { EmailDriver, EmailDriverDeclaration } from './email';
import { emailTransport } from './email';
import type { SmsDriver, SmsDriverDeclaration } from './sms';
import { smsTransport } from './sms';
import type { WebPushDriverDeclaration, WebPushSender, WebPushSubscriptionSource } from './web-push';
import { webPushTransport } from './web-push';
import type { WhatsAppDriver, WhatsAppDriverDeclaration } from './whatsapp';
import { whatsAppTransport } from './whatsapp';

/**
 * The transport registry: the router dispatches through this, so adding a
 * channel = registering one adapter and the router, generators and existing
 * transports are untouched (open/closed).
 *
 * A mount declares its channels and gets a registry; nothing is process-wide.
 * future-pay registered its four transports as an IMPORT SIDE EFFECT of the
 * package's root entry, which made "which channels are on" a property of the
 * module graph rather than of any configuration — importing the inbox helpers
 * in a unit test silently armed four transports.
 */

/** One channel's declaration. The union is closed; the drivers are not. */
export type TransportDeclaration =
  | EmailDriverDeclaration
  | SmsDriverDeclaration
  | WhatsAppDriverDeclaration
  | WebPushDriverDeclaration;

/** A host's own vendors, added per channel without touching the package. */
export interface ExtraDrivers {
  email?: Record<string, (declaration: EmailDriverDeclaration) => EmailDriver>;
  sms?: Record<string, (declaration: SmsDriverDeclaration) => SmsDriver>;
  whatsapp?: Record<string, (declaration: WhatsAppDriverDeclaration) => WhatsAppDriver>;
  webPush?: Record<string, (declaration: WebPushDriverDeclaration) => WebPushSender>;
}

export interface TransportRegistry {
  /** The adapter for `channel`, or null when the host declared none. */
  get(channel: NotificationChannel): NotificationTransport<never> | null;
  /** Every declared adapter, in declaration order. */
  list(): NotificationTransport<never>[];
  /** Register (or replace, last-wins) an adapter built by the host itself. */
  register<TMessage>(transport: NotificationTransport<TMessage>): void;
  /** The VAPID public key, when the WEB_PUSH channel declared one. */
  webPushPublicKey(): string | null;
}

function build(
  declaration: TransportDeclaration,
  subscriptions: WebPushSubscriptionSource,
  extra: ExtraDrivers,
): NotificationTransport<never> {
  switch (declaration.channel) {
    case 'EMAIL':
      return emailTransport(declaration, extra.email ?? {}) as NotificationTransport<never>;
    case 'SMS':
      return smsTransport(declaration, extra.sms ?? {}) as NotificationTransport<never>;
    case 'WHATSAPP':
      return whatsAppTransport(
        declaration,
        extra.whatsapp ?? {},
      ) as NotificationTransport<never>;
    case 'WEB_PUSH':
      return webPushTransport(
        declaration,
        subscriptions,
        extra.webPush ?? {},
      ) as NotificationTransport<never>;
  }
}

export function createTransportRegistry(
  declarations: readonly TransportDeclaration[],
  subscriptions: WebPushSubscriptionSource,
  extra: ExtraDrivers = {},
): TransportRegistry {
  const transports = new Map<NotificationChannel, NotificationTransport<never>>();
  let publicKey: string | null = null;
  for (const declaration of declarations) {
    if (transports.has(declaration.channel)) {
      throw new Error(
        `@12-apps/notifications: the ${declaration.channel} channel is declared twice.`,
      );
    }
    if (declaration.channel === 'WEB_PUSH') publicKey = declaration.publicKey ?? null;
    transports.set(declaration.channel, build(declaration, subscriptions, extra));
  }
  return {
    get: (channel) => transports.get(channel) ?? null,
    list: () => [...transports.values()],
    register(transport) {
      transports.set(transport.channel, transport as NotificationTransport<never>);
    },
    webPushPublicKey: () => publicKey,
  };
}
