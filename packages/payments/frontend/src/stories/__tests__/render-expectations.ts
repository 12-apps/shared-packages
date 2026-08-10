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

/** The Dados step at rest — where most full-flow checkout stories open. */
const DADOS_STEP: RenderExpectation = {
  testIds: ["checkout-stepper", "buyer-cpf", "checkout-pay-bar", "checkout-continue"],
  text: ["Informe seu CPF (obrigatório para o pagamento)."],
};

export const EXPECTATIONS: Record<string, RenderExpectation> = {
  // -------------------------------------------------------------- Checkout
  // `/config` stalling or failing must fail OPEN: the buyer form renders, no
  // error is raised — so the marker for both gates is the ordinary Dados step.
  "Checkout/ConfigPending": DADOS_STEP,
  "Checkout/ConfigFailed": DADOS_STEP,
  "Checkout/NoProviderConnected": {
    testIds: ["checkout-payments-disabled"],
    text: ["Pagamento online indisponível"],
  },
  "Checkout/NoProviderWithRemedy": {
    testIds: ["checkout-payments-remedy", "checkout-payments-remedy-action"],
    text: ["Chamar garçom"],
  },
  "Checkout/HostVetoWithLiveChain": {
    testIds: ["checkout-payments-disabled"],
    text: ["Pagamento online indisponível"],
  },
  // The chain-shape stories open on Dados; their differences are one
  // Continuar away (the method tiles, the card form, the failure copy).
  "Checkout/PixOnly": DADOS_STEP,
  "Checkout/CardOnly": DADOS_STEP,
  "Checkout/PixAndCard": DADOS_STEP,
  "Checkout/StubTokenizationGranted": DADOS_STEP,
  "Checkout/TokenizationNone": DADOS_STEP,
  "Checkout/RedirectChain": DADOS_STEP,
  "Checkout/TwoMintableProviders": DADOS_STEP,
  "Checkout/RedirectHeadMintableTail": DADOS_STEP,
  "Checkout/IssuerDecline": DADOS_STEP,
  "Checkout/PaymentUnresolved": DADOS_STEP,
  "Checkout/PaymentUnavailable": DADOS_STEP,
  "Checkout/RequiresTaxId": DADOS_STEP,
  "Checkout/RequiresPhone": {
    testIds: ["buyer-phone"],
    absentTestIds: ["buyer-cpf"],
    text: ["Informe seu telefone (obrigatório para o pagamento)."],
  },
  "Checkout/RequiresNothing": {
    absentTestIds: ["buyer-cpf"],
    text: ["Nome, e-mail e telefone são opcionais"],
  },
  // Dados is skipped (CPF on file), so the server's 400 already rendered.
  "Checkout/MissingBuyerFieldFromServer": {
    testIds: ["checkout-payer", "checkout-error", "checkout-retry-payment"],
    text: ["Informe: taxId."],
  },
  "Checkout/EmptyCartFlow": { testIds: ["checkout-empty", "checkout-empty-back"] },
  "Checkout/ComandaTable": { testIds: ["checkout-pay-bar"], text: ["R$ 214,00"] },
  "Checkout/ComandaMine": { testIds: ["checkout-pay-bar"], text: ["R$ 62,50"] },
  "Checkout/HostDiscountLines": {
    testIds: ["checkout-pay-bar"],
    text: ["Cupom BEMVINDO · −R$ 7,50"],
  },
  "Checkout/TaxIdOnFile": {
    testIds: ["checkout-payer", "checkout-method", "checkout-method-PIX", "checkout-method-CARD"],
    text: ["Pagando como Ana Compradora", "CPF já cadastrado"],
  },
  "Checkout/SavedCardsAvailable": DADOS_STEP,
  "Checkout/SavedCardNotUsableHere": DADOS_STEP,
  "Checkout/ConfirmationExtra": DADOS_STEP,

  // --------------------------------------------------------------- Screens
  "Screens/MethodChoiceBoth": {
    testIds: ["checkout-method-PIX", "checkout-method-CARD"],
    text: ["escolhido: —"],
  },
  "Screens/MethodChoicePixOnly": {
    testIds: ["checkout-method-PIX"],
    absentTestIds: ["checkout-method-CARD"],
    text: ["escolhido: PIX"],
  },
  "Screens/MethodChoiceCardUnmintable": {
    testIds: ["checkout-method-CARD"],
    text: ["Indisponível nesta loja", "escolhido: PIX"],
  },
  "Screens/BuyerDetailsTaxId": {
    testIds: ["buyer-cpf"],
    text: ["Informe seu CPF (obrigatório para o pagamento)."],
  },
  "Screens/BuyerDetailsPhone": {
    testIds: ["buyer-phone"],
    absentTestIds: ["buyer-cpf"],
    text: ["Informe seu telefone (obrigatório para o pagamento)."],
  },
  "Screens/BuyerDetailsNothingRequired": {
    absentTestIds: ["buyer-cpf"],
    text: ["Nome, e-mail e telefone são opcionais"],
  },
  "Screens/BuyerDetailsPerMethod": {
    testIds: ["buyer-cpf"],
    text: ["Informe seu CPF (obrigatório para o pagamento)."],
  },
  "Screens/BuyerDetailsServerRefusal": { testIds: ["buyer-cpf"], text: ["Informe: taxId."] },
  "Screens/PixPaymentLive": {
    testIds: ["pix-view", "pix-qr", "pix-code", "pix-awaiting"],
    text: ["Pague com PIX"],
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
  "Screens/PayerSummaryWithEdit": {
    testIds: ["checkout-payer", "checkout-payer-edit"],
    text: ["CPF 529.982.247-25"],
  },
  "Screens/PayerSummarySavedTaxId": {
    testIds: ["checkout-payer"],
    text: ["CPF já cadastrado"],
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
    testIds: ["buyer-cpf", "checkout-pay-bar"],
    text: ["slots padrão (MUI)", "design system do host"],
  },
  "Composition/HeadlessByHand": {
    testIds: ["card-number", "card-pay"],
    text: ["/config respondeu com 1 provedor(es); tokenização PUBLIC_KEY."],
  },

  // ------------------------------------------------------- ProviderScreens
  "ProviderScreens/PixCodeOnOurPage": {
    testIds: ["pix-view", "pix-code"],
    text: ["Pague com PIX"],
  },
  // Pinned EMPTINESS: no payable yet, so the screen deliberately stays out of
  // the way — anything on screen here (an error alert included) is a failure.
  "ProviderScreens/AwaitingTheMethodChoice": { empty: true },
  "ProviderScreens/HandoffNotice": {
    testIds: ["checkout-handoff-pending"],
    text: ["Você será levado à página segura do provedor"],
  },
  "ProviderScreens/DeclaresNothingAndStillWorks": {
    testIds: ["pix-view", "pix-code"],
    text: ["Pague com PIX"],
  },
  "ProviderScreens/UnknownIdFromANewerServer": {
    testIds: ["pix-view", "pix-code"],
    text: ["Pague com PIX"],
  },
  "ProviderScreens/UnknownIdOnAHandoffStore": { testIds: ["checkout-handoff-pending"] },
  "ProviderScreens/CapabilityDefaultDirect": { testIds: ["checkout-handoff-pending"] },

  // ----------------------------------------------------------- PlatformOps
  "PlatformOps/ConnectApplicationAllVerdicts": {
    testIds: ["connect-application-panel", "connect-mismatch-SANDBOX", "connect-match-PRODUCTION"],
    text: ["Callback desta instalação"],
  },
  "PlatformOps/ConnectApplicationUnconfigured": {
    testIds: ["connect-application-panel"],
    text: ["Nenhuma aplicação configurada neste ambiente."],
  },
  "PlatformOps/ConnectApplicationDegraded": {
    testIds: ["connect-error-SANDBOX", "connect-unknown-PRODUCTION"],
    text: ["não foi possível comparar com o callback desta instalação."],
  },
  "PlatformOps/HomologacaoNeverRequested": {
    testIds: ["platform-homologacao", "homologacao-status-chip", "homologacao-anexo-button"],
    text: ["Não solicitada"],
  },
  "PlatformOps/HomologacaoApproved": {
    testIds: ["homologacao-status-chip", "homologacao-save-ok"],
    text: ["Aprovada", "Registro atualizado."],
  },
  "PlatformOps/HomologacaoRejected": {
    testIds: ["homologacao-status-chip"],
    text: ["Recusada", "Decidida em"],
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
  "Settings/SettingsReadFailed": { text: ['{"error":"indisponível","code":"SERVER_ERROR"}'] },
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
    text: ["ProduçãoSua conta está conectada."],
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
    text: ["Desconectar"],
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
      'cabeça com CARD + GOOGLE_PAY + parâmetros → {"gateway":"aurora","gatewayMerchantId":"MID_LOJA_1"}',
      "config sem chain (host antigo) → null",
      "cabeça anterior ao campo wallets (host antigo) → false",
      "canMakePayments() lança (tratado como não) → false",
    ],
  },
  "Wallets/WalletFastLaneAssembled": {
    testIds: ["apple-pay-button", "google-pay-button", "card-view", "card-pay"],
    text: ["ou pague com cartão", "Pagar R$ 75,00"],
  },

  // ---------------------------------------------------------------- Legacy
  "Legacy/CheckoutFlowByHand": DADOS_STEP,
  // The method chooser — precisely what a dead `/config` wire replaces with
  // an error alert, which is why it is the marker.
  "Legacy/CheckoutPaymentPixAndCard": {
    text: ["Total: R$ 75,00", "Forma de pagamento", "Gerar QR Code PIX"],
  },
  // Same chooser at rest; the saved-card radios are one "Cartão" tap in.
  "Legacy/CheckoutPaymentSavedCards": {
    text: ["Total: R$ 75,00", "Forma de pagamento"],
  },
  "Legacy/CheckoutPaymentRedirect": {
    text: ["Continuar para o pagamento"],
    absentText: ["Forma de pagamento"],
  },
  "Legacy/CheckoutPaymentStoreOff": {
    text: ["Esta loja ainda não aceita pagamentos online."],
  },
  "Legacy/CheckoutPaymentLoading": { testIds: ["checkout-payment-loading"] },
  "Legacy/SavedCardsPickerDirect": {
    testIds: ["saved-cards"],
    text: ["Visa •••• 4242", "Validade 04/2030", "Selecionado: cartao_1"],
  },
  "Legacy/CopyOverridden": {
    testIds: ["checkout-payments-disabled", "buyer-cpf"],
    text: [
      "Pagamentos em pausa na cantina",
      "Ir para o pagamento",
      "padrão: “Pagamento online indisponível”",
    ],
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
};
