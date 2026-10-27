/**
 * WHAT EACH STORY MUST SHOW once its mount settles — the render suite's
 * per-story manifest (`stories-render.test.tsx`).
 *
 * Why this exists: "mounts without throwing" is not "renders its pinned
 * state". The settings and checkout components catch a dead wire into an
 * error alert, so a suite without these markers stayed green with the
 * client's request paths deliberately broken — every Settings story showing
 * the red alert instead of the page it documents. Each entry names something
 * that exists ONLY when the story's own state rendered: a testid the error
 * path cannot produce, a sentence of the pinned copy.
 *
 * Choosing a marker for a new story:
 *  - a story driven by an in-page mount asserts DOM the mount's ANSWER
 *    produces (a provider card, the method chooser, the priority list) —
 *    never the loading spinner or the error alert, unless the gate itself is
 *    the story;
 *  - a props-only story asserts its key content;
 *  - `absent*` pins what the story documents as NOT rendering (a withheld
 *    button, a gated-away wallet);
 *  - `empty: true` is for the one story whose pinned state is "renders
 *    nothing at all".
 *
 * Text fragments are matched against the page's whitespace-NORMALIZED
 * `textContent` (runs of whitespace collapse to one space), so adjacent
 * elements concatenate exactly as they read.
 */
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY as PLATFORM } from '../../components/platform/pt-BR';

export interface RenderExpectation {
  /** data-testids that must be present. */
  testIds?: readonly string[];
  /** Text fragments that must appear (whitespace-normalized). */
  text?: readonly string[];
  /** data-testids that must NOT be present. */
  absentTestIds?: readonly string[];
  /** Text fragments that must NOT appear (whitespace-normalized). */
  absentText?: readonly string[];
  /** The pinned state IS an empty render. */
  empty?: true;
}

/** The list's top for a buyer with no CPF on file: the CPF field and the bar. */
const LIST_TOP = ["payment-list", "list-buyer-taxId", "list-pay"] as const;

/** Pagamento — the one list — at rest for a new buyer, offering both methods. */
const LIST_NEW_BUYER: RenderExpectation = {
  testIds: [...LIST_TOP, "list-option-PIX", "list-option-CARD"],
  absentTestIds: ["checkout-continue", "checkout-method"],
};

export const EXPECTATIONS: Record<string, RenderExpectation> = {
  // -------------------------------------------------------------- Checkout
  // Every full-flow story opens on Pagamento, which is the one list (FUT-4028):
  // the CPF at its top for a new buyer, then the rows the chain can drive.
  // `/config` stalling holds the list on its loading face; failing fails OPEN
  // to the ordinary rows — no error is raised.
  "Checkout/ConfigPending": { testIds: ["payment-list-loading", "list-pay"] },
  "Checkout/ConfigFailed": LIST_NEW_BUYER,
  "Checkout/NoProviderConnected": {
    testIds: ["checkout-payments-disabled"],
    absentTestIds: ["payment-list"],
    text: ["Pagamento online indisponível"],
  },
  "Checkout/NoProviderWithRemedy": {
    testIds: ["checkout-payments-remedy", "checkout-payments-remedy-action"],
    text: ["Chamar garçom"],
  },
  "Checkout/HostVetoWithLiveChain": {
    testIds: ["checkout-payments-disabled"],
    absentTestIds: ["payment-list"],
    text: ["Pagamento online indisponível"],
  },
  // The chain-shape stories differ in the rows the list draws.
  "Checkout/PixOnly": { ...LIST_NEW_BUYER, testIds: [...LIST_TOP, "list-option-PIX"], absentTestIds: ["list-option-CARD"] },
  "Checkout/CardOnly": { ...LIST_NEW_BUYER, testIds: [...LIST_TOP, "list-option-CARD", "card-number"], absentTestIds: ["list-option-PIX"] },
  "Checkout/PixAndCard": LIST_NEW_BUYER,
  "Checkout/StubTokenizationGranted": { ...LIST_NEW_BUYER, testIds: [...LIST_TOP, "list-option-CARD", "card-number"] },
  "Checkout/TokenizationNone": LIST_NEW_BUYER,
  "Checkout/RedirectChain": {
    testIds: [...LIST_TOP, "list-option-HAND_OFF"],
    absentTestIds: ["list-option-PIX", "list-option-CARD"],
    text: ["Você paga na página da aurora"],
  },
  "Checkout/TwoMintableProviders": { ...LIST_NEW_BUYER, testIds: [...LIST_TOP, "list-option-CARD", "card-number"] },
  "Checkout/RedirectHeadMintableTail": { ...LIST_NEW_BUYER, testIds: [...LIST_TOP, "list-option-CARD", "card-number"] },
  "Checkout/IssuerDecline": { ...LIST_NEW_BUYER, testIds: [...LIST_TOP, "list-option-CARD", "card-number"] },
  "Checkout/PaymentUnresolved": LIST_NEW_BUYER,
  "Checkout/PaymentUnavailable": LIST_NEW_BUYER,
  "Checkout/RequiresTaxId": LIST_NEW_BUYER,
  // A chain that asks a phone and no CPF: no CPF at the top; the phone is the
  // row's own field once a row is chosen.
  "Checkout/RequiresPhone": {
    testIds: ["payment-list", "list-option-PIX", "list-option-CARD"],
    absentTestIds: ["list-buyer-taxId"],
  },
  "Checkout/RequiresNothing": {
    testIds: ["payment-list", "list-option-PIX", "list-option-CARD"],
    absentTestIds: ["list-buyer-taxId"],
  },
  "Checkout/EmptyCartFlow": { testIds: ["checkout-empty", "checkout-empty-back"] },
  "Checkout/ComandaTable": { testIds: ["payment-list", "list-bar-total"], text: ["R$ 214,00"] },
  "Checkout/ComandaMine": { testIds: ["payment-list", "list-bar-total"], text: ["R$ 62,50"] },
  "Checkout/HostDiscountLines": { testIds: ["payment-list", "list-bar-total"] },
  "Checkout/TaxIdOnFile": {
    testIds: ["list-payer", "list-payer-change", "list-option-PIX", "list-option-CARD"],
    absentTestIds: ["list-buyer-taxId"],
    text: ["Ana Compradora · CPF ✓"],
  },
  "Checkout/SavedCardsAvailable": { testIds: [...LIST_TOP, "list-option-CARD", "list-card-card_1", "list-card-card_2", "list-card-new"] },
  "Checkout/SavedCardNotUsableHere": { testIds: [...LIST_TOP, "list-option-CARD", "list-card-card_1", "list-card-new"] },
  "Checkout/ConfirmationExtra": { ...LIST_NEW_BUYER, testIds: [...LIST_TOP, "list-option-CARD", "card-number"] },

  // --------------------------------------------------------------- Screens
  "Screens/PixPaymentLive": {
    testIds: ["pix-view", "pix-qr", "pix-code", "pix-awaiting"],
    text: ["Pague com Pix"],
  },
  "Screens/CardEntryNewCard": {
    testIds: ["card-view", "card-number", "card-pay"],
    text: ["Pagar R$ 75,00"],
  },
  "Screens/CardEntryWithSavedCards": {
    testIds: ["card-view", "saved-cards", "card-pay"],
    text: ["visa •••• 4242", "Novo cartão"],
  },
  "Screens/StatusPaid": {
    testIds: ["payment-paid", "payment-receipt"],
    text: ["Pedido confirmado"],
  },
  "Screens/StatusPaidWithHostHero": {
    testIds: ["payment-paid", "payment-paid-hero", "payment-receipt"],
    text: ["Pedido confirmado"],
  },
  "Screens/StatusFailed": {
    testIds: ["payment-failed"],
    text: ["Nenhum valor foi cobrado. Você pode tentar novamente."],
  },
  "Screens/StatusExpired": { testIds: ["payment-expired"], text: ["O código expirou"] },
  "Screens/StatusAwaiting": {
    testIds: ["payment-awaiting_payment", "payment-pending"],
    text: ["Confirmando seu pagamento"],
  },
  "Screens/UnavailableNoRemedy": {
    testIds: ["checkout-payments-disabled"],
    text: ["Pagamento online indisponível"],
  },
  "Screens/UnavailableWithRemedy": {
    testIds: ["checkout-payments-remedy-action"],
    text: ["Chamar garçom"],
  },
  "Screens/SavedCardsList": { testIds: ["saved-cards"], text: ["Novo cartão"] },
  "Screens/SavedCardsEmpty": { text: ["(nada acima desta linha — é o estado vazio)"] },
  "Screens/EmptyCartScreen": { testIds: ["checkout-empty"], text: ["Seu carrinho está vazio."] },

  // ----------------------------------------------------------------- Vault
  // The add-card form at rest — `begin` answered through the real mount, so
  // the marker is the live form, never the preparing spinner.
  "Vault/AddCardForm": {
    testIds: ["add-card", "card-number", "card-holder", "add-card-save"],
    text: ["Adicionar cartão", "Salvar cartão"],
  },
  "Vault/AddCardSaving": {
    testIds: ["add-card", "add-card-save"],
    text: ["salvando: a chamada /cards/complete está em voo"],
  },
  "Vault/AddCardSaved": {
    testIds: ["add-card-saved"],
    text: ["Cartão salvo", "visa •••• 4242", "Validade 12/2031"],
  },
  "Vault/AddCardDeclined": {
    testIds: ["add-card", "add-card-error", "card-number"],
    text: ["O cartão foi recusado. Confira o número e tente novamente."],
  },
  // The real mount's VAULT_NOT_ENABLED 404, worded by the factory's own copy —
  // and no form: a screen that cannot save must not collect a card.
  "Vault/AddCardUnavailable": {
    testIds: ["add-card-unavailable"],
    text: ["Esta loja não aceita salvar cartões no momento."],
    absentTestIds: ["add-card-save", "card-number"],
  },
  "Vault/ManageCardsEmpty": {
    testIds: ["manage-cards", "manage-cards-empty", "manage-cards-add"],
    text: ["Meus cartões", "Você ainda não tem cartões salvos."],
  },
  "Vault/ManageCardsPopulated": {
    testIds: ["manage-cards", "manage-cards-list", "manage-cards-item-card_1", "manage-cards-add"],
    text: ["visa •••• 4242", "mastercard •••• 0005", "Validade 04/2030"],
    absentTestIds: ["manage-cards-empty"],
  },

  // ---------------------------------------------------------------- Hosted
  "Hosted/Interstitial": {
    testIds: ["checkout-hosted-handoff", "checkout-hosted-link"],
    text: ["Você será levado ao pagamento"],
  },
  "Hosted/InterstitialWithCancel": {
    testIds: ["checkout-hosted-handoff", "checkout-hosted-cancel"],
    text: ["Você será levado ao pagamento"],
  },
  "Hosted/ReturnWithNothingParked": {
    testIds: ["checkout-hosted-return-unknown"],
    text: ["Não encontramos um pagamento em andamento nesta sessão."],
  },

  // ----------------------------------------------------------- Composition
  "Composition/SlotsSideBySide": {
    testIds: ["list-buyer-taxId", "list-pay"],
    text: ["slots padrão (MUI)", "design system do host"],
  },
  "Composition/HeadlessByHand": {
    testIds: ["card-number", "card-pay"],
    text: ["/config respondeu com 1 provedor(es); tokenização PUBLIC_KEY."],
  },

  // ------------------------------------------------------- ProviderScreens
  "ProviderScreens/PixCodeOnOurPage": {
    testIds: ["pix-view", "pix-code"],
    text: ["Pague com Pix"],
  },
  // Pinned EMPTINESS: no payable yet, so the screen deliberately stays out of
  // the way — anything on screen here (an error alert included) is a failure.
  "ProviderScreens/AwaitingTheMethodChoice": { empty: true },
  "ProviderScreens/HandoffNotice": {
    testIds: ["checkout-handoff-pending"],
    // The SAME sentence the invite made — see the story's own comment.
    text: ["Você será levado à página de pagamento da Boreal"],
  },
  "ProviderScreens/DeclaresNothingAndStillWorks": {
    testIds: ["pix-view", "pix-code"],
    text: ["Pague com Pix"],
  },
  "ProviderScreens/UnknownIdFromANewerServer": {
    testIds: ["pix-view", "pix-code"],
    text: ["Pague com Pix"],
  },
  "ProviderScreens/UnknownIdOnAHandoffStore": { testIds: ["checkout-handoff-pending"] },
  "ProviderScreens/CapabilityDefaultDirect": { testIds: ["checkout-handoff-pending"] },

  // ----------------------------------------------------------- PlatformOps
  // The platform screens take their words from the pack the stories mount, so
  // these READ the pack rather than restating it. A copy port would otherwise
  // fail here as a "wire break" while the wire was fine — which is the one
  // failure mode this manifest must not produce.
  "PlatformOps/ConnectApplicationAllVerdicts": {
    testIds: ["connect-application-panel", "connect-mismatch-SANDBOX", "connect-match-PRODUCTION"],
    text: [PLATFORM.connect.expectedRedirectHeading],
  },
  "PlatformOps/ConnectApplicationPreviewAndPaste": {
    testIds: ["connect-preview-SANDBOX", "connect-preview-PRODUCTION", "connect-pasted"],
    text: [PLATFORM.connect.previewHeading, PLATFORM.connect.pasted.heading],
  },
  "PlatformOps/ConnectApplicationUnconfigured": {
    testIds: ["connect-application-panel"],
    text: [PLATFORM.connect.noApplication],
  },
  "PlatformOps/ConnectApplicationDegraded": {
    testIds: ["connect-error-SANDBOX", "connect-unknown-PRODUCTION"],
    text: [PLATFORM.connect.redirectUnreported],
  },
  "PlatformOps/HomologacaoNeverRequested": {
    testIds: ["platform-homologacao", "homologacao-status-chip", "homologacao-anexo-button"],
    text: [PLATFORM.outcome.notSubmitted],
  },
  "PlatformOps/HomologacaoApproved": {
    testIds: ["homologacao-status-chip", "homologacao-save-ok"],
    text: [PLATFORM.outcome.statuses.APPROVED ?? "", PLATFORM.outcome.saved],
  },
  "PlatformOps/HomologacaoRejected": {
    testIds: ["homologacao-status-chip"],
    // The trail's own leading word, which is all that proves the clause
    // rendered — the date beside it is the runtime's, not the pack's.
    text: [PLATFORM.outcome.statuses.REJECTED ?? "", PLATFORM.outcome.decidedAt("").split(" ")[0] ?? ""],
  },

  // -------------------------------------------------------------- Settings
  "Settings/FreshCatalog": {
    testIds: [
      "payments-provider-settings",
      "payments-provider-card-aurora",
      "payments-provider-card-boreal",
      "payments-provider-card-infinito",
    ],
    text: ["Escolha o provedor de pagamento", "Não conectado"],
  },
  // Adjacent name+badge pairs, so each card is pinned to ITS badge — plain
  // "Conectado" would also match inside "Não conectado".
  "Settings/CatalogBadges": {
    testIds: ["payments-provider-card-vega"],
    text: [
      "Aurora PagamentosNão conectado",
      "Boreal PayConectado",
      "Vega PagamentosAtivo",
      "Infinito ContaReconectar",
    ],
  },
  "Settings/SavedVerified": {
    testIds: ["payments-status", "payments-enabled-toggle", "payments-save"],
    text: ["CONEXÃO OK", "Configurado — deixe em branco para manter o valor atual."],
  },
  "Settings/ProvenEnabled": {
    testIds: ["payments-credential-summary"],
    text: ["VERIFICADO", "Recebendo vendas", "$aurora-matriz"],
  },
  "Settings/ManualFormDirtyState": {
    testIds: ["payments-save"],
    text: ["Salvar Tag de recebimento", "NÃO VERIFICADO"],
  },
  "Settings/ReverifyWarningAtRest": {
    testIds: ["payments-reverify-warning", "payments-save"],
    text: ["exige uma nova verificação", "para de receber"],
  },
  "Settings/ConfirmMoneyDestination": {
    testIds: ["payments-confirm-credential", "payments-confirm-credential-value"],
    text: ["Confirme para onde vai o dinheiro", "$loja-da-ana"],
  },
  // At rest these two read exactly like the dirty-state form — the probe's
  // alert exists only after driving a save, which their docblocks say.
  "Settings/VerifyFails": {
    testIds: ["payments-save"],
    text: ["Salvar Tag de recebimento", "NÃO VERIFICADO"],
  },
  "Settings/VerifyUnreachable": {
    testIds: ["payments-save"],
    text: ["Salvar Tag de recebimento", "NÃO VERIFICADO"],
  },
  // The gate stories: here the gate IS the pinned state, so asserting it is
  // legitimate — everywhere else these markers are exactly what a wire break
  // produces, and are therefore banned.
  // The host's sentence, not the gateway's envelope or message.
  "Settings/SettingsReadFailed": { text: ["Não foi possível concluir a operação (500). Tente novamente."] },
  "Settings/SettingsReadPending": { testIds: ["payments-settings-loading"] },
  "Settings/ProductionEnvironment": {
    testIds: ["payments-environment-notice-PRODUCTION"],
    text: ["Produção — dinheiro real. Tudo o que você fizer aqui vale para as vendas da loja."],
  },
  "Settings/EnvironmentElsewhereNote": {
    testIds: ["payments-environment-notice-SANDBOX", "payments-environment-notice-PRODUCTION"],
    text: ["Hoje a loja está usando Produção.", "Hoje a loja está usando Sandbox."],
  },
  "Settings/OAuthConnected": {
    testIds: ["payments-connected-environment", "payments-connected-account"],
    text: ["financeiro@lojadaana.com.br", "Sandbox (testes)", "Autorização válida até"],
  },
  "Settings/OAuthExpiring": {
    testIds: ["payments-expiry-warning"],
    text: ["A autorização expira em"],
  },
  "Settings/ReconnectRequired": {
    testIds: ["payments-connected-account"],
    text: ["RECONECTAR", "A autorização expirou ou foi revogada."],
  },
  "Settings/OAuthWithoutConnectSeam": {
    testIds: ["payments-save"],
    text: [
      "o botão de conexão não está disponível nesta instalação",
      "Salvar Token de acesso",
    ],
    absentText: ["Conectar com Infinito Conta"],
  },
  // The FUT-691 layout: guide + probe visible beside the collapsed disclosure.
  "Settings/OAuthGuideUnburied": {
    testIds: [
      "payments-setup-guide",
      "payments-setup-section-habilitar",
      "payments-oauth-verify",
      "payments-manual-fallback",
    ],
    text: ["Testar conexão", "Passo 2 · Habilite as cobranças online"],
  },
  "Settings/FailoverChain": {
    testIds: ["payments-priority-list", "payments-priority-item-aurora", "payments-priority-first"],
    text: ["O checkout tenta Aurora Pagamentos primeiro"],
  },
  "Settings/SetupGuideOpen": {
    testIds: ["payments-setup-guide", "payments-setup-section-conta", "payments-setup-warning"],
    text: ["Passo 1 · Informe sua Tag de recebimento"],
  },
  "Settings/SetupGuideConfirmStep": {
    testIds: ["payments-setup-section-habilitar", "payments-credential-summary"],
    text: ["Já habilitei o Checkout Integrado", "$vega-matriz"],
  },
  "Settings/ActivationSlotConnected": {
    testIds: ["story-activation-slot", "story-activation-pay"],
    text: ["conectado: true", "comprovado: false"],
  },
  "Settings/ActivationSlotProven": {
    testIds: ["story-activation-slot", "story-activation-proven"],
    text: ["comprovado: true"],
    absentTestIds: ["story-activation-pay"],
  },
  "Settings/ActivationSlotBlocked": {
    testIds: ["story-activation-slot", "payments-setup-section-habilitar"],
    text: ["bloqueado: true", "oculto: true"],
    absentTestIds: ["story-activation-pay"],
  },
  "Settings/ActivationSlotOAuth": {
    testIds: ["story-activation-slot", "story-activation-pay", "payments-connection-probe"],
    text: ["conectado: true"],
  },

  // ------------------------------------------------------------ Connection
  "Connection/ConnectInvitation": {
    text: ["Conectar com Infinito Conta", "Nenhuma chave precisa ser copiada."],
    absentTestIds: ["payments-connected-account"],
  },
  "Connection/ConnectedAccount": {
    testIds: ["payments-connected-environment", "payments-connected-account"],
    text: [
      "financeiro@lojadaana.com.br",
      "Criar cobranças",
      // The unknown scope, deliberately raw:
      "repasses.read",
      "Autorização válida até",
    ],
  },
  "Connection/ConnectedLegacyGrant": {
    testIds: ["payments-connected-environment"],
    text: ["Sua conta está conectada."],
    absentTestIds: ["payments-connected-account"],
  },
  // Name+chip adjacency: "Produção" alone would match inside other copy.
  "Connection/ConnectedProduction": {
    testIds: ["payments-connected-environment", "payments-connected-account"],
    text: ["Produção", "Sua conta está conectada."],
    absentText: ["Sandbox (testes)"],
  },
  "Connection/ExpiryNear": {
    testIds: ["payments-expiry-warning"],
    text: ["A autorização expira em"],
  },
  "Connection/ExpiryPast": {
    testIds: ["payments-expiry-warning"],
    text: ["A autorização expirou em"],
    absentText: ["A autorização expirou ou foi revogada."],
  },
  "Connection/ReconnectBanner": {
    testIds: ["payments-expiry-warning"],
    text: ["A autorização expirou ou foi revogada.", "Reconectar"],
  },
  "Connection/DisconnectFlow": {
    testIds: ["payments-connected-account"],
    text: ["Remover conexão"],
  },
  // The chips are COMPUTED by the driven service — asserting the printed
  // `statusBadge → …` lines pins label AND color per row.
  "Connection/StatusChipGallery": {
    testIds: ["payments-status", "payments-enabled-toggle"],
    text: [
      "statusBadge → NÃO VERIFICADO · default — Tag salva, conexão nunca testada",
      "statusBadge → NÃO VERIFICADO · default — O teste de conexão reprovou (status FAILED)",
      "statusBadge → CONEXÃO OK · info",
      "statusBadge → VERIFICADO · success",
      "statusBadge → RECONECTAR · error",
      "A precedência do dinheiro",
    ],
  },

  // ------------------------------------------------------------ Priorities
  "Priorities/MerchantOrder": {
    testIds: ["payments-priority-item-boreal", "payments-priority-first"],
    text: ["O checkout tenta Boreal Pay primeiro"],
  },
  "Priorities/KeyboardReorder": {
    testIds: ["payments-priority-item-aurora", "payments-priority-item-boreal"],
    text: ["O checkout tenta Aurora Pagamentos primeiro"],
  },
  "Priorities/SingleProvider": {
    testIds: ["payments-priority-item-aurora", "payments-priority-first"],
    text: ["O checkout tenta Aurora Pagamentos primeiro"],
  },
  "Priorities/EmptyChain": {
    testIds: ["payments-priority-empty"],
    text: ["Nenhum provedor está ativo."],
  },
  "Priorities/DeclineCascade": {
    testIds: ["payments-decline-policy"],
    text: ["Uma recusa passa para o próximo da lista."],
  },
  // At rest the stale three-name list — the refusal is one driven arrow away.
  "Priorities/ReorderRejected": {
    testIds: ["payments-priority-item-boreal", "payments-priority-item-infinito"],
    text: ["O checkout tenta Aurora Pagamentos primeiro"],
  },

  // ------------------------------------------------------------ SetupGuide
  "SetupGuide/AllSections": {
    testIds: ["payments-setup-section-conta", "payments-setup-section-habilitar"],
    text: ["Passo 1 · Informe sua Tag de recebimento", "Passo 2 · Habilite as cobranças online"],
  },
  "SetupGuide/HostAction": {
    testIds: ["payments-setup-section-revisao"],
    text: ["Gerar o arquivo de evidências"],
  },
  "SetupGuide/HostActionMissing": {
    testIds: ["payments-setup-section-revisao"],
    text: ["Anexe o arquivo de evidências"],
    absentText: ["Gerar o arquivo de evidências"],
  },
  "SetupGuide/CopyReference": {
    testIds: ["payments-setup-copy-reveal"],
    text: ["URL da chave pública (referência)", "Ver o guia"],
  },
  "SetupGuide/ConfirmStepHolds": {
    testIds: ["story-tag-salva", "payments-setup-section-habilitar", "story-form-slot"],
    text: ["Já habilitei o Checkout Integrado"],
  },
  "SetupGuide/ConfirmedCollapsed": {
    testIds: ["payments-setup-confirmed", "payments-setup-confirmed-edit"],
    text: ["Habilitadas na conta", "Revisar"],
    // With no open section, the footer slot is gone too — the doc's claim.
    absentText: ["Aqui o host monta o formulário de credenciais do provedor."],
  },
  "SetupGuide/NoGuide": {
    testIds: ["story-tag-salva", "story-form-slot"],
    absentText: ["Habilitar cobranças"],
  },
  "SetupGuide/UnstoredEnvironment": {
    testIds: ["payments-setup-section-conta", "story-form-slot"],
    text: ["Passo 1 · Informe sua Tag de recebimento"],
  },
  "SetupGuide/EditingCredential": {
    testIds: ["payments-setup-section-conta", "story-form-slot"],
    text: ["Passo 1 · Informe sua Tag de recebimento"],
    // The confirmed step's ✓ row is withheld while editing — the doc's claim.
    absentText: ["Habilitadas na conta"],
  },

  // --------------------------------------------------------------- Wallets
  "Wallets/GooglePayReady": {
    testIds: ["google-pay-button"],
    text: ["Pagar com Google Pay", "isReadyToPay aprovou: sim"],
  },
  "Wallets/GooglePayDeviceNotReady": {
    text: ["isReadyToPay aprovou: ainda não"],
    absentTestIds: ["google-pay-button"],
  },
  "Wallets/GooglePayNotDeclared": {
    text: ["googlePayConfig: null — o botão nem chega a montar"],
    absentTestIds: ["google-pay-button"],
  },
  "Wallets/GooglePaySheetDismissed": {
    testIds: ["google-pay-button"],
    text: ["— nenhum até agora —"],
  },
  "Wallets/GooglePaySheetFails": {
    testIds: ["google-pay-button"],
    text: ["— nenhum até agora —"],
  },
  "Wallets/ApplePayReady": {
    testIds: ["apple-pay-button"],
    text: ["applePaySupported(): true"],
  },
  "Wallets/ApplePayNoDevice": {
    text: ["applePaySupported(): false"],
    absentTestIds: ["apple-pay-button"],
  },
  "Wallets/ApplePayChargeDeclined": { testIds: ["apple-pay-button"] },
  "Wallets/ApplePaySheetCancelled": { testIds: ["apple-pay-button"] },
  "Wallets/ApplePayValidationMissing": { testIds: ["apple-pay-button"] },
  "Wallets/ApplePayValidationRejected": { testIds: ["apple-pay-button"] },
  // Computed verdicts, printed — each row pins one clause's answer.
  "Wallets/CapabilityGates": {
    text: [
      'cabeça com CARD + GOOGLE_PAY + parâmetros → {"gateway":"aurora","gatewayMerchantId":"MID_LOJA_1","environment":"TEST"}',
      "config sem chain (host antigo) → null",
      "cabeça anterior ao campo wallets (host antigo) → false",
      "canMakePayments() lança (tratado como não) → false",
    ],
  },
  "Wallets/WalletFastLaneAssembled": {
    testIds: ["apple-pay-button", "google-pay-button", "card-view", "card-pay"],
    text: ["ou pague com cartão", "Pagar R$ 75,00"],
  },

  // -------------------------------------------------------------- Headless
  "Headless/PixChargeLifecycle": {
    text: ["Provedor ativo aurora, tokenização PUBLIC_KEY.", "Gerar cobrança PIX"],
  },
  "Headless/DeclinedCardIsSettled": {
    text: ["Provedor ativo aurora, tokenização PUBLIC_KEY.", "Cobrar no cartão"],
  },
  // The refusal names the missing field; the reset button exists only in the
  // error state. The full envelope is deliberately NOT pinned — it is a
  // package defect the story documents, not a contract.
  "Headless/ChargeRefusedAndReset": {
    text: ["Provedor ativo aurora", "taxId", "Tentar de novo"],
  },

  // ----------------------------------------------------------- TenderSplit
  // At rest nothing is picked: every tender is a card, the bar names the
  // whole bill as missing, and the confirm asks for a first tender.
  "TenderSplit/PtBr": {
    testIds: ["tender-split-option-CASH", "tender-split-option-PIX", "tender-split-confirm"],
    text: ["Falta R$ 444,40", "Escolha a forma"],
    absentTestIds: ["tender-split-change"],
  },
  "TenderSplit/EnUs": {
    testIds: ["tender-split-option-CASH", "tender-split-confirm"],
    text: ["Left $82.00", "Pick a method"],
  },
  // ------------------------------------------------- PaymentList (FUT-3591)
  // The one list at rest: the saved card comes chosen and Pagar is live; a new
  // buyer has nothing chosen; a hand-off store offers its one row; no door
  // options means no door heading.
  "PaymentList/SavedCard": {
    testIds: ["payment-list", "list-card-vault_1", "list-door-cash", "list-pay"],
    text: ["Pagar agora, pelo app", "Pagar na entrega", "Visa 4242 ou outro cartão"],
  },
  "PaymentList/NewBuyer": {
    testIds: ["payment-list", "list-option-PIX", "list-option-CARD"],
    text: ["Escolha como pagar."],
  },
  "PaymentList/HandOffStore": {
    testIds: ["payment-list", "list-option-HAND_OFF"],
    text: ["Pix ou cartão"],
    absentTestIds: ["list-option-PIX"],
  },
  "PaymentList/OnlineOnly": {
    testIds: ["payment-list", "list-card-vault_1"],
    text: ["Pagar agora, pelo app"],
    absentTestIds: ["list-door-cash"],
  },
  // ------------------------------------------- PaymentListStates (FUT-3591/3592)
  // The starting points of the harder runs; the visual gate plays the clicks.
  "PaymentListStates/GooglePay": {
    testIds: ["payment-list", "list-wallets", "list-google-pay"],
    text: ["Pagamento rápido", "ou escolha como pagar"],
    absentTestIds: ["list-option-GOOGLE_PAY"],
  },
  "PaymentListStates/StalePix": {
    testIds: ["payment-list", "host-bump-cart", "host-hold"],
  },
  "PaymentListStates/HostHold": {
    testIds: ["payment-list", "host-bump-cart", "host-hold"],
  },
  "PaymentListStates/RaiseRefused": {
    testIds: ["payment-list", "list-pay"],
  },
  "PaymentListStates/ChargeUnresolved": {
    testIds: ["payment-list", "list-card-vault_1"],
  },
  "PaymentListStates/DoorOnly": {
    testIds: ["payment-list", "list-door-cash", "list-door-reader"],
    absentTestIds: ["list-option-PIX", "list-option-CARD"],
  },
  "PaymentListStates/LongPayerName": {
    testIds: ["payment-list", "list-payer", "list-payer-change"],
    text: ["Maria Aparecida dos Santos"],
  },
  // ------------------------------------------- PaymentListWallets (FUT-3685)
  // The wallet block and the CPF at the top; the visual gate plays the presses.
  "PaymentListWallets/NoWallet": {
    testIds: ["payment-list", "list-card-vault_1"],
    absentTestIds: ["list-wallets", "list-cpf"],
    absentText: ["Pagamento rápido", "ou escolha como pagar"],
  },
  "PaymentListWallets/GoogleOnly": {
    testIds: ["list-wallets", "list-google-pay"],
    text: ["Pagamento rápido", "ou escolha como pagar"],
    absentTestIds: ["list-apple-pay", "list-option-GOOGLE_PAY"],
  },
  "PaymentListWallets/BothWallets": {
    testIds: ["list-wallets", "list-google-pay", "list-apple-pay"],
  },
  "PaymentListWallets/CpfMissing": {
    testIds: ["list-cpf", "list-buyer-taxId", "list-save-profile", "list-wallets", "list-wallets-held"],
    text: ["CPF", "a aurora pede para pagar pelo app", "Digite seu CPF ou CNPJ para pagar pelo app."],
  },
  "PaymentListWallets/CpfOnFile": {
    testIds: ["list-wallets", "list-payer", "list-payer-change"],
    absentTestIds: ["list-cpf", "list-wallets-held"],
  },
  "PaymentListWallets/StoreCredit": {
    testIds: ["list-wallets", "list-pay"],
    text: ["R$ 22,00"],
  },
  "PaymentListWallets/Desktop": {
    testIds: ["list-cpf", "list-wallets"],
  },
  "PaymentListWallets/DesktopReturning": {
    testIds: ["list-wallets", "list-card-vault_1"],
  },
};
