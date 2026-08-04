/**
 * `@12-apps/payments-frontend` — the browser half of the payments platform.
 *
 * Plug-and-play MUI components for the two payment surfaces (per-provider
 * settings page, checkout payment step), plus the headless hooks and fetch
 * clients they are built on for hosts that want their own pixels. Imports
 * only TYPES from `@12-apps/payments-backend`; talks exclusively to the host's
 * mounted payments HTTP surface.
 */
export {
  createPaymentsClient,
  createPaymentsSettingsClient,
  isSettled,
  PaymentsClientError,
  type ClientChargeRequest,
  type ClientPaymentsConfig,
  type PaymentsClient,
  type PaymentsClientOptions,
  type PaymentsSettingsClient,
} from './client';

export {
  PaymentsProvider,
  useChargeStatus,
  useCreateCharge,
  usePaymentsClient,
  type ChargeRef,
  type ChargeStatusOptions,
  type ChargeStatusState,
  type CreateChargeState,
  type PaymentsProviderProps,
} from './context';

export {
  CheckoutPayment,
  type CardFormValues,
  type CheckoutPaymentProps,
  type SavedCardOption,
} from './components/CheckoutPayment';
export { CheckoutFlow, type CheckoutFlowProps } from './components/CheckoutFlow';
export {
  ProviderConnection,
  type ProviderConnectionProps,
} from './components/ProviderConnection';
export {
  ProviderPriorityList,
  type ProviderPriorityListProps,
} from './components/ProviderPriorityList';
export {
  ProviderSetupGuide,
  type ProviderSetupGuideProps,
} from './components/ProviderSetupGuide';
export {
  CHECKOUT_CONFIRM_ACTION,
  SetupGuideSection,
  type SetupGuideSectionProps,
} from './components/SetupGuideSection';
export { ProviderStatusBar, statusBadge } from './components/ProviderStatusBar';
export {
  PaymentProviderSettings,
  type PaymentProviderSettingsProps,
} from './components/PaymentProviderSettings';

/**
 * Re-exported because it appears in the `prepareConnect` prop a host must
 * implement: without it the host could not type its own callback without
 * taking a direct dependency on the backend package.
 */
export type { PaymentEnvironment } from '@12-apps/payments-backend';
