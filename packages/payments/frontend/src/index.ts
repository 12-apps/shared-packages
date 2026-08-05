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

// ---------------------------------------------------------------------------
// The buyer checkout surface (FUT-564) — the storefront's three-step flow,
// mounted by a host in one line. See ADOPTING.md §3 for the ports and the
// design-system slot contract.
// ---------------------------------------------------------------------------
export {
  CheckoutFlow,
  type CheckoutCartView,
  type CheckoutFlowProps,
} from './components/checkout/checkout-flow';
export { type CheckoutHostPorts } from './components/checkout/use-checkout-controller';
export { PaymentsUnavailable } from './components/checkout/payments-unavailable';
export { fetchCheckoutConfig } from './components/checkout/client';
export {
  CheckoutComponentsProvider,
  type CheckoutActionBarProps,
  type CheckoutAlertProps,
  type CheckoutButtonProps,
  type CheckoutCheckboxProps,
  type CheckoutComponents,
  type CheckoutInputProps,
  type CheckoutLoadingStateProps,
  type CheckoutRadioGroupProps,
  type CheckoutRadioOption,
  type CheckoutStepperProps,
  type CheckoutStepperStep,
  type CheckoutTextProps,
} from './components/checkout/ui';
export {
  type BuyerContact,
  type BuyerField,
  type BuyerInfo,
  type CheckoutError,
  type CheckoutOrder,
  type CheckoutProviderConfig,
  type ComandaCheckout,
  type CreateOrderRequest,
  type CreateOrderResult,
  type OrderStatus,
  type PaymentMethod,
} from './components/checkout/types';

// The shared card-entry surface (form + tokenizer), used by the checkout above
// and by the admin's provider-activation charge (FUT-463) — same fields, same
// validation, same tokenization, or the activation proves nothing.
export {
  CardPayBar,
  NewCardForm,
  SavedCardsPicker,
  cvvLength,
  detectBrand,
  formatCardNumber,
  formatCpf,
  formatCvv,
  formatExpiry,
  onlyDigits,
  tokenizeCard,
  tokenizeForCheckout,
  tokenizerFor,
  validateCardNumber,
  validateCpf,
  validateCvv,
  validateExpiry,
  validateHolder,
  NEW_CARD,
  type CardBrand,
  type CardDetails,
  type CardFieldErrors,
  type CardToken,
  type CardTokenizationConfig,
  type CardTokenizer,
  type SavedCard,
} from './card';
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
