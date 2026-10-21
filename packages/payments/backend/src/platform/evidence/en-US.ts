import type { HomologacaoEvidenceCopy } from './types';

/**
 * The en-US pack for the homologação evidence file (FUT-3696) — the
 * translation of `PT_BR_HOMOLOGACAO_EVIDENCE_COPY`, for an operator reading
 * the file. What goes to PagBank's form is the pt-BR file: their reviewer
 * reads Portuguese, so a host submitting evidence passes the pt-BR pack.
 */
export const EN_US_HOMOLOGACAO_EVIDENCE_COPY: HomologacaoEvidenceCopy = {
  title: 'HOMOLOGATION EVIDENCE — PAGBANK (CONNECT API AND ORDERS API, PIX AND CARD) — SANDBOX',
  statusLabels: { EXECUTED: 'EXECUTED', FAILED: 'FAILED', PENDING: 'PENDING' },
  sectionTitles: {
    CONNECT: 'Connect evidence',
    PIX: 'Pix evidence',
    CARD: 'Card evidence',
    DEBIT: "Debit card (PagBank's 3DS)",
    GOOGLE_PAY: 'Google Pay (digital wallet)',
    APPLE_PAY: 'Apple Pay (digital wallet)',
  },
  steps: {
    'connect.authorize': {
      scenario: "Test seller account authorization (login and consent at PagBank)",
      expected: "The test seller signs in to PagBank's sandbox, approves the consent and is redirected to the callback with code and state.",
    },
    'connect.callback': {
      scenario: "Return to the integration's callback",
      expected: 'The callback receives code and state; the state matches the one the integration issued for this authorization.',
    },
    'connect.exchange': {
      scenario: 'Authorization code exchanged for a token — POST /oauth2/token',
      expected: "HTTP 200 with the seller's access_token and refresh_token; the tokens are stored encrypted and never shown.",
    },
    'connect.application': {
      scenario: 'Application consult — GET /oauth2/application/{client_id}',
      expected: "HTTP 200 with the application's data, including its registered redirect_uri.",
    },
    'connect.refresh': {
      scenario: "Seller token renewal — POST /oauth2/refresh",
      expected: 'HTTP 200 or 201 with a new access_token; the new token pair replaces the previous one.',
    },
    'connect.usage': {
      scenario: "Use of the seller's authorization in the orders",
      expected: "Every order below is authenticated with the seller's access_token from Connect, never the platform's token.",
    },
    'pix.create': {
      scenario: 'Order with a Pix QR Code created — POST /orders',
      expected: 'HTTP 201 with the order (ORDE_…) and qr_codes[] with the copy-and-paste text and image links. Creating the QR is NOT a payment.',
    },
    'pix.consult': {
      scenario: 'Pix order consulted — GET /orders/{order_id}',
      expected: "HTTP 200 with the order's current state and, once paid, charges[] with the charge (CHAR_…).",
    },
    'pix.paid': {
      scenario: 'Pix payment confirmed in the sandbox',
      expected: "The sandbox simulator pays Pix orders up to R$ 100.00; the consult returns the charge as PAID.",
    },
    'pix.webhook': {
      scenario: 'Pix payment notification received and processed by the integration',
      expected: "PagBank POSTs to the order's notification_url; the integration verifies the signature, stores the event and updates the charge's status.",
    },
    'card.publicKey': {
      scenario: "Seller's public key for card encryption — POST /public-keys",
      expected: "HTTP 200/201 with public_key, minted with the seller's token (a public key is public, not a secret).",
    },
    'card.encrypt': {
      scenario: 'Card data prepared — encryption in the browser (PagSeguro.encryptCard)',
      expected: "The official test cards are encrypted in the browser with the seller's public key; only the encrypted value reaches the server.",
    },
    'card.approved': {
      scenario: 'Approved credit card order (authorization with capture) — POST /orders',
      expected: 'HTTP 201 with charges[0].status PAID: the integration authorizes and captures in one call (capture: true).',
    },
    'card.approvedConsult': {
      scenario: 'Approved card result consulted — GET /orders/{order_id}',
      expected: 'HTTP 200 with the order and its charge PAID.',
    },
    'card.declined': {
      scenario: 'Declined credit card order — POST /orders',
      expected: 'HTTP 201 with charges[0].status DECLINED and the decline code/message in payment_response.',
    },
    'card.cancel': {
      scenario: 'Approved charge canceled/refunded — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 with the charge canceled (status CANCELED).',
    },
    'card.webhook': {
      scenario: 'Card notifications received and processed by the integration',
      expected: "PagBank POSTs to the card orders' notification_url; the integration stores the events and updates the charges' status.",
    },
    'debit.session': {
      scenario: '3DS authentication session — POST /checkout-sdk/sessions',
      expected: "HTTP 200/201 with session and expires_at, minted server-side with the seller's token; the browser sets up the SDK (PagSeguro.setUp) with it.",
    },
    'debit.authenticate': {
      scenario: '3DS authentication of the debit card (Visa test card 4000 0000 0000 2701, no challenge)',
      expected: "PagBank's SDK (PagSeguro.authenticate3DS) authenticates the encrypted test card in the browser for R$ 27.01: status AUTH_FLOW_COMPLETED, AUTHENTICATED, with the authentication id.",
    },
    'debit.approved': {
      scenario: 'Order with an authenticated debit card (DEBIT_CARD) — POST /orders',
      expected: 'HTTP 201 with charges[0].status PAID: payment_method DEBIT_CARD carrying authentication_method { type: THREEDS, id } from the authentication above.',
    },
    'debit.consult': {
      scenario: 'Debit order consulted — GET /orders/{order_id}',
      expected: 'HTTP 200 with the order and the debit charge in status PAID.',
    },
    'debit.cancel': {
      scenario: 'Debit payment canceled — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 with the debit charge canceled (status CANCELED).',
    },
    'gpay.token': {
      scenario: "Google Pay token obtained in the browser (Google's TEST environment, gateway pagbank)",
      expected:
        "The operator opens Google Pay's sheet (PaymentsClient in TEST; PAYMENT_GATEWAY tokenizationSpecification with gateway pagbank and " +
        "gatewayMerchantId = the test seller's PagBank account), for R$ 12.00, and picks one of Google's test cards; the browser receives " +
        'paymentMethodData.tokenizationData.token. No request from the integration to PagBank in this step.',
    },
    'gpay.approved': {
      scenario: 'Approved Google Pay order (card.wallet GOOGLE_PAY) — POST /orders',
      expected:
        'HTTP 201 with charges[0].status PAID: payment_method CREDIT_CARD with card.wallet { type: GOOGLE_PAY, key } (the Google Pay token), ' +
        'authorized and captured in one call (capture: true).',
    },
    'gpay.consult': {
      scenario: 'Google Pay order consulted — GET /orders/{order_id}',
      expected: 'HTTP 200 with the order and the Google Pay charge in status PAID.',
    },
    'gpay.cancel': {
      scenario: 'Google Pay payment canceled — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 with the Google Pay charge canceled (status CANCELED).',
    },
    'apay.token': {
      scenario: 'Apple Pay token obtained in the browser (ApplePaySession with merchant validation)',
      expected:
        "The operator opens Apple Pay's sheet in Safari (ApplePaySession version 3, Visa and Mastercard), for R$ 12.00; the integration " +
        "validates the merchant server-side with the platform's Apple Pay identity and the browser receives token.paymentData. No " +
        'request from the integration to PagBank in this step.',
    },
    'apay.approved': {
      scenario: 'Approved Apple Pay order (card.wallet APPLE_PAY) — POST /orders',
      expected:
        "HTTP 201 with charges[0].status PAID: payment_method CREDIT_CARD with card.wallet { type: APPLE_PAY, key } (Apple Pay's " +
        'token.paymentData), authorized and captured in one call (capture: true).',
    },
    'apay.consult': {
      scenario: 'Apple Pay order consulted — GET /orders/{order_id}',
      expected: 'HTTP 200 with the order and the Apple Pay charge in status PAID.',
    },
    'apay.cancel': {
      scenario: 'Apple Pay payment canceled — POST /charges/{charge_id}/cancel',
      expected: 'HTTP 201 with the Apple Pay charge canceled (status CANCELED).',
    },
  },
  identification: {
    heading: 'Identification',
    name: 'Name',
    site: 'Site',
    environment: 'Environment',
    testsAt: 'Test date and time',
    testsAtConnect: 'Connect',
    testsAtRun: 'Pix and card',
    situation: ({ executed, failed, pending }) =>
      failed + pending === 0
        ? `all ${executed} scenarios executed with the expected result`
        : `INCOMPLETE — ${executed} executed · ${failed} failed · ${pending} pending (see Pending items)`,
    clientId: 'Application client_id',
    callback: 'Callback (redirect_uri)',
    generatedAt: 'File generated at',
    notRun: 'not executed',
  },
  labels: {
    index: 'Scenario index',
    scenario: 'Scenario',
    status: 'Status',
    time: 'Time',
    notes: 'Record',
    request: 'Request',
    response: 'Response',
    httpStatus: 'HTTP status',
    noResponse: (error) => `No HTTP response (network failure: ${error})`,
    ids: 'IDs for correlation',
    expected: 'Expected result',
    observed: 'Observed result',
    conclusion: 'Conclusion',
    noCalls: 'No request from the integration to PagBank in this scenario.',
    noCallsPending: 'Not executed — no request recorded.',
  },
  redactionNote:
    'Security: Authorization, access_token, refresh_token, client_secret, OAuth codes, cookies, ' +
    "CVV, the full card number, the encrypted card data and the digital wallets' token (Google Pay and Apple Pay, " +
    'card.wallet.key) were removed and show as ***REDACTED***. ' +
    "Every call below was recorded by the integration's own code as it was made; no response was " +
    "written by hand. Data and cards are PagBank's official test ones.",
  pendencies: {
    heading: '8. Pending items',
    incomplete: (failed, pending) =>
      `INCOMPLETE FILE: ${pending} ${pending === 1 ? 'scenario' : 'scenarios'} pending and ${failed} failed. Do not submit this file as complete.`,
    allExecuted: 'Every scenario listed above was executed with the expected result.',
    notCovered: [
      'Not covered by any scenario: card brands other than VISA (Mastercard, Amex, Elo, Hiper).',
      'Not tested: installments (the orders use 1 installment).',
      'Not applicable: later capture (pre-authorization). The integration authorizes and captures in one call (capture: true).',
      'Not tested: boleto.',
      'Google Pay and Apple Pay: the approved payment, its consult and its cancellation are covered; a wallet decline is not tested.',
      'Notifications refused at signature verification are not stored. A missing notification may not have been sent, or may have been refused.',
    ],
    noGuarantee: "This file records only what was executed and does not guarantee PagBank's approval of the homologation.",
  },
  outcome: {
    notRun: 'Not executed.',
    asExpected: 'As expected.',
    notAsExpected: 'Not as expected — not approved.',
    awaitingConsent: (url) => `Authorization URL generated (${url}); waiting for the seller's login and consent.`,
    consentGiven: 'The seller approved the consent and PagBank redirected to the callback with the code.',
    consentRefused: (error) => `PagBank returned to the callback with error=${error}; consent was not given.`,
    callbackReceived: () => 'Callback received with code (removed) and state; the state matches the one issued.',
    callbackWithoutCode: (error) =>
      `Callback received without a code${error ? ` (error=${error})` : ''}; the state matches the one issued, but there is no code to exchange.`,
    callbackStateMismatch: 'Callback received, but the state does not match the one issued; the code was not exchanged.',
    callError: (detail) => `The call failed: ${detail}`,
    httpAnswered: (status) => `PagBank answered HTTP ${status}.`,
    exchangeStored: (accountId) =>
      `Seller tokens received and stored encrypted${accountId ? ` (account_id ${accountId})` : ''}.`,
    applicationConsulted: 'Application consulted; the registered redirect_uri matches the callback.',
    applicationRedirectMismatch: "Application consulted, but the registered redirect_uri differs from the integration's callback.",
    refreshed: 'Token renewed; the new pair replaced the previous one.',
    refreshRejected: "PagBank refused the renewal; the seller's connection must be authorized again.",
    usageSellerToken: (calls, seller, platform) =>
      `${calls === 1 ? 'The order, public-key or 3DS-session call was' : `The ${calls} order, public-key and 3DS-session calls were`} authenticated with the seller's token ` +
      `(SHA-256 fingerprint ${seller}, recorded on every request above)` +
      (platform ? `, different from the platform's token (${platform}).` : '.'),
    usageOtherToken:
      "Some call was authenticated with a token other than the seller's current one — the seller's authorization was not proven.",
    usageSameAsPlatform: "The seller's token is the platform's — the seller's authorization was not proven.",
    usageNotConnected: 'No sandbox test seller connected; connect one before generating the evidence.',
    notSandbox: "The test seller's connection is not a sandbox one; nothing was executed.",
    qrCreated: (orderId) => `QR Code created on order ${orderId}. This is NOT yet a confirmed payment.`,
    qrMissing: 'The order was created without a QR Code.',
    consultStatus: (status, polls) => `Order consulted ${polls} ${polls === 1 ? 'time' : 'times'}; final status ${status}.`,
    paid: 'Payment confirmed: the Pix charge is PAID in the consult.',
    notPaidYet: (seconds) => `Payment not confirmed within ${seconds} s of consults.`,
    publicKeyMinted: "Public key minted with the seller's token.",
    publicKeyMissing: 'The public key was not minted.',
    encrypted: (cards) => `Cards encrypted in the browser: ${cards}.`,
    encryptFailed: (detail) => `Card encryption in the browser did not complete${detail ? `: ${detail}` : ''}.`,
    browserFailures: {
      SDK_UNAVAILABLE: "PagBank's SDK did not load in the browser",
      NOT_PROCESSED: "PagBank's SDK did not encrypt the card",
      NO_PUBLIC_KEY: 'no public key for the seller',
      NO_THREEDS_SESSION: 'no 3DS session for the seller',
      THREEDS_NOT_SUPPORTED: 'PagBank said the card does not support 3DS authentication (AUTH_NOT_SUPPORTED)',
      THREEDS_REFUSED: 'PagBank refused the 3DS authentication (CHANGE_PAYMENT_METHOD)',
      THREEDS_FAILED: 'the 3DS authentication in the browser did not complete',
    },
    chargeStatus: (status) => `Charge with status ${status}.`,
    canceled: (status) => `Cancellation recorded with status ${status}.`,
    threeDSSessionMinted: "3DS session minted with the seller's token.",
    threeDSSessionMissing: 'The 3DS session was not minted.',
    threeDSAuthenticated: (authenticated) =>
      authenticated
        ? '3DS authentication completed in the browser: AUTHENTICATED, no challenge.'
        : '3DS authentication completed in the browser, but the cardholder was not authenticated (NOT_AUTHENTICATED).',
    threeDSFailed: (detail) => `3DS authentication of the debit card did not complete${detail ? `: ${detail}` : ''}; no debit was charged.`,
    debitNotReported: 'The browser reported no debit card; no debit was charged.',
    walletNames: { GOOGLE_PAY: 'Google Pay', APPLE_PAY: 'Apple Pay' },
    walletTokenReceived: (wallet, card) =>
      `${wallet} token received in the browser${card ? ` (${card})` : ''}; it went to the server only and shows as ***REDACTED***.`,
    walletNotRun: (wallet) =>
      `Not executed: the ${wallet} button was not pressed before generating the file; no ${wallet} order was created.`,
    walletFailed: (wallet, detail) =>
      `${wallet} token not obtained in the browser${detail ? `: ${detail}` : ''}; no ${wallet} order was created.`,
    walletFailures: {
      NOT_AVAILABLE: 'the wallet is not offered on this browser/device',
      DISMISSED: 'the operator closed the payment sheet',
      NOT_CONFIGURED: 'waiting for the Apple Developer account — Apple Pay identity not configured',
      MERCHANT_VALIDATION_FAILED: "Apple Pay's merchant validation did not complete",
      TOKEN_ERROR: 'the payment sheet failed or returned no token',
    },
    applePayNotConfigured:
      'Pending: waiting for the Apple Developer account — Apple Pay identity not configured (Merchant ID and certificate). ' +
      'No Apple Pay order was created.',
    webhookReceived: (count, statuses, chargeStatus) =>
      `${count} ${count === 1 ? 'notification' : 'notifications'} received and stored (status: ${statuses})` +
      (chargeStatus ? `; the charge the integration records is ${chargeStatus}.` : '.'),
    webhookNone: 'No notification received by the time this file was generated.',
    webhookFailed: 'Notification received, but processing failed.',
    webhookNotProcessed: (statuses, chargeStatus) =>
      `Notification received, but not processed yet (status: ${statuses}` +
      (chargeStatus ? `; charge ${chargeStatus})` : ')') + '.',
    enableFailed: (detail) => `Tokens received and stored, but the seller could not be enabled for orders: ${detail}`,
  },
};
