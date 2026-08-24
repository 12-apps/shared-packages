/**
 * `createWebPaymentsSettings` — the MERCHANT half of this package, mounted
 * rather than composed.
 *
 * `createPaymentFlows` already does this for the buyer: one call, one bound
 * transport, and the host mounts what comes back. The owner's settings page
 * had no equivalent, so every host imported `PaymentProviderSettings` and
 * threaded the same `PaymentsSettingsClient` into it at the call site — the
 * one object that is genuinely per-tenant and genuinely built once. This
 * binds it, and nothing else.
 *
 * ## WHAT STAYS A PROP, and why
 *
 * **`copy`.** Every sentence this surface renders follows the READER's
 * locale, which a host resolves per render. Binding the pack at factory time
 * would pin the screen to whichever language was in effect when the host
 * built it — a language switch that changes the chrome and leaves the
 * settings page behind.
 *
 * **`prepareConnect`, `selectedProvider` / `onProviderChange`,
 * `initialProvider`, `onChanged`.** The OAuth CSRF state is minted against
 * the host's admin session; which provider is open may live in the host's
 * URL. Both are the host's, per render, and a factory that froze them would
 * make the page uncontrollable.
 */

import type { ComponentType, JSX } from "react";

import {
  PaymentProviderSettings,
  type PaymentProviderSettingsProps,
} from "../components/PaymentProviderSettings";
import type { PaymentsSettingsClient } from "../client";

/** What a host binds ONCE: the settings port. */
export interface PaymentsSettingsWebConfig {
  /**
   * The host's settings transport — its origin, its tenancy, its auth.
   * `createPaymentsSettingsClient` builds one; a host with its own
   * authenticated fetch may implement the interface directly.
   */
  client: PaymentsSettingsClient;
}

/** The settings page's remaining props once the port is bound. */
export type BoundPaymentsSettingsProps = Omit<PaymentProviderSettingsProps, "client">;

/**
 * The bound surface. `page` is a component TYPE, so a host must hold the
 * object across renders — the wiring consumer's binder does that once per
 * adoption.
 */
export interface PaymentsSettingsSurface {
  /** The whole provider-settings page: list, connection, credentials, priority. */
  page: ComponentType<BoundPaymentsSettingsProps>;
}

/** Build the owner's payment-settings surface for a host. */
export function createWebPaymentsSettings(
  config: PaymentsSettingsWebConfig,
): PaymentsSettingsSurface {
  const { client } = config;
  const Page = (props: BoundPaymentsSettingsProps): JSX.Element => (
    <PaymentProviderSettings {...props} client={client} />
  );
  return { page: Page };
}
