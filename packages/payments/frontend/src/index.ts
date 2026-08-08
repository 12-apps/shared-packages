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

// ---------------------------------------------------------------------------
// The MOUNTED buyer checkout (FUT-741) — `createPaymentFlows` returns every
// screen pre-bound to one transport, one scope, one slot table and one set of
// host ports. Additive: everything above and below stays exported, and the
// hand-composing path is unchanged.
// ---------------------------------------------------------------------------
export { createPaymentFlows } from './flows/create-payment-flows';
export {
  DEFAULT_CHECKOUT_COPY_FE,
  type CheckoutCopyFE,
} from './flows/copy';
export {
  type BoundCheckoutClient,
  type BuyerDetailsProps,
  type CheckoutAvailability,
  type CheckoutConfigState,
  type CheckoutController,
  type CheckoutPorts,
  type CheckoutScreens,
  type PaymentFlows,
  type PaymentFlowsConfig,
} from './flows/types';
export {
  buyerFieldsFor,
  fieldSatisfied,
} from './components/checkout/buyer-fields';
export {
  createCheckoutClient,
  DEFAULT_CHECKOUT_BASE_URL,
  type CheckoutClient,
  type CheckoutTransport,
} from './components/checkout/transport';
export { type CheckoutHostPorts } from './components/checkout/use-checkout-controller';
export { PaymentsUnavailable } from './components/checkout/payments-unavailable';
export { fetchCheckoutConfig } from './components/checkout/client';
// ---------------------------------------------------------------------------
// Digital wallets (FUT-471/472) — the Google-branded button and the capability
// read it is gated on. `CheckoutFlow` wires these automatically; they are
// exported for hosts composing their own pixels.
// ---------------------------------------------------------------------------
export {
  GooglePayButton,
  type GooglePayApi,
  type GooglePayButtonProps,
  type GooglePaymentData,
  type GooglePaymentsClient,
  type GooglePayGatewayParams,
} from './components/checkout/google-pay-button';
export { googlePayConfig } from './components/checkout/method-capability';
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
  type ChargeWalletInput,
  type CheckoutChainLink,
  type CheckoutCustomerField,
  type CheckoutError,
  type CheckoutOrder,
  type CheckoutProviderConfig,
  type CheckoutWalletType,
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

// ---------------------------------------------------------------------------
// The PLATFORM operations screens (FUT-479 / FUT-483, packaged by FUT-573) —
// the Connect-application consult and the homologação, as dumb components a
// host page mounts with data + callbacks from its own routes. Their backend
// halves live in `@12-apps/payments-backend` (`consultConnectApplications`,
// `platformHomologacaoGuide`, `createHomologationRecordService`,
// `buildPlatformHomologacaoAnexo`).
// ---------------------------------------------------------------------------
export {
  ConnectApplicationPanel,
  type ConnectApplicationPanelProps,
} from './components/platform/ConnectApplicationPanel';
export {
  PlatformHomologacao,
  type PlatformHomologacaoProps,
} from './components/platform/PlatformHomologacao';
export {
  type HomologacaoSaveInput,
  type HomologacaoSaveState,
  type PlatformHomologationRecordView,
} from './components/platform/HomologacaoOutcomeCard';

/**
 * Re-exported because it appears in the `prepareConnect` prop a host must
 * implement: without it the host could not type its own callback without
 * taking a direct dependency on the backend package.
 */
export type { PaymentEnvironment } from '@12-apps/payments-backend';
