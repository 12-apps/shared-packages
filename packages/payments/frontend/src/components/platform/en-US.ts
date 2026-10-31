import type { PlatformHomologacaoCopy } from './copy';

/**
 * The en-US pack for the platform's homologação screens.
 *
 * A NAMED pack, which is how this repo ships a language: a host imports it and
 * passes it by hand.
 *
 * ## What is translated here, and what is not
 *
 * These screens are read by the platform OPERATOR filling PagBank's form, and
 * that is what the words are for — so the instructions, headings and statuses
 * are English here.
 *
 * What stays is everything the operator has to MATCH against PagBank's own
 * surfaces: `redirect_uri` is the parameter name in the API response, "SIP" and
 * "Pipefy" are the names of the systems they will open, `ACCESS_DENIED` is the
 * error string they are quoting in the ticket, and "homologação" is what
 * PagBank calls the process — an operator searching support for
 * "homologation" finds nothing.
 *
 * The ANSWERS the form is filled with are a different matter and are not here
 * at all: they live in `@12-apps/payments-backend`'s `PT_BR_HOMOLOGACAO_ANSWERS`
 * and stay Portuguese, because a PagBank reviewer reads them and several are
 * multiple-choice options on the form itself.
 */
const BASE: Omit<PlatformHomologacaoCopy, 'productionEvidence'> = {
  outcome: {
    heading: 'Homologação status',
    statusLabel: 'Status',
    notSubmitted: 'Not submitted',
    protocolLabel: 'Protocol',
    protocolPlaceholder: 'Protocol (Pipefy card / ticket)',
    notesLabel: 'Notes',
    notesPlaceholder: "Notes (PagBank's reply, context…)",
    save: 'Record',
    saved: 'Record updated.',
    // The KEYS are the stored status values, not words.
    statuses: { SUBMITTED: 'Submitted', APPROVED: 'Approved', REJECTED: 'Rejected' },
    // Three fragments the screen concatenates into one line, so the first two
    // keep their trailing space and the last one ends the sentence.
    submittedAt: (when) => `Submitted ${when}. `,
    decidedAt: (when) => `Decided ${when}. `,
    recordedBy: (who) => `Recorded by ${who}.`,
  },
  guide: {
    heading: 'Homologação form — answers ready to paste',
    // Five fragments wrapping two links. Each keeps its own leading or
    // trailing space; a translation that made them whole sentences would break
    // the line the screen actually renders.
    ledeBeforeForm: 'Open the ',
    formLink: 'official homologação form',
    ledeBeforeSupport: ' and fill it in with the values below. In parallel, open a ticket on ',
    supportLink: 'SIP — PagBank integration support',
    ledeBeforeDocs:
      ' quoting the 403 ACCESS_DENIED: what you answer first decides whether the form covers Connect. Documentation: ',
    docsLink: 'requesting homologação',
    ledeAfterDocs: '.',
  },
  anexo: {
    heading: 'Evidence attachment',
    body:
      "The form asks for the requests and responses of the calls sent to PagBank's APIs. The file is generated from this platform's real calls, with the token redacted.",
    generate: 'Generate attachment',
    generateFailed: 'Could not generate the attachment.',
  },
  connect: {
    expectedRedirectHeading: 'The callback this deploy uses (the value that must be registered)',
    consultAgain: 'Look it up again',
    noApplication: 'No application configured in this environment.',
    // `redirect_uri` is the parameter name in PagBank's own response — an
    // operator compares the two strings character by character.
    redirectMatches: 'The registered redirect_uri matches the callback this deploy uses.',
    redirectDiffers:
      'The redirect_uri registered with PagBank differs from the callback this deploy uses. The OAuth authorization flow fails silently until the registration is fixed at PagBank.',
    redirectUnreported:
      "PagBank's response carried no redirect_uri, so it could not be compared with the callback.",
    fields: {
      name: 'Name (shown to the store owner)',
      site: 'Site',
      description: 'Description',
      logo: 'Logo',
      redirectUri: 'registered redirect_uri',
    },
    fieldEmpty: '—',
    redirectNotReported: 'not reported',
    resolvedFrom:
      "This environment's application is resolved from these variables. The client_id and client_secret are strict, with no fallback between environments; the others, such as the token, fall back to the unsuffixed variable when this environment's own is unset:",
    showConfig: 'Show environment variables',
    hideConfig: 'Hide environment variables',
    extraKeys: 'Other fields returned (undocumented schema)',
    environmentLabels: { SANDBOX: 'Sandbox', PRODUCTION: 'Production' },
    previewHeading: 'First 5 characters of each variable',
    previewUnset: 'not set',
    previewInherited: 'not set — uses the unsuffixed variable:',
    // `client_id` / `client_secret` are PagBank's own parameter names.
    credentialNames: { clientId: 'client_id', clientSecret: 'client_secret', accountToken: 'account token' },
    pasted: {
      heading: 'Test other credentials',
      lede:
        "Paste an application's credentials to look it up at PagBank before changing the environment variables. The values are used for this lookup only and are not saved.",
      environment: 'Environment',
      submit: 'Look up with these credentials',
      failed: 'The pasted credentials could not be looked up.',
      secretNotChecked:
        'PagBank does not check the client_secret in this lookup — only the client_id and the token. A wrong client_secret only shows at the first store authorization.',
    },
  },
  evidence: {
    heading: 'Homologation evidence (sandbox)',
    lede: "Runs the real scenarios in PagBank's sandbox and builds the TXT for the form. Nothing is charged.",
    sellerHeading: 'Test seller',
    sellerConnected: (connectedAt, accountId) =>
      `Connected${connectedAt ? ` on ${new Date(connectedAt).toLocaleString('en-US')}` : ''}` +
      (accountId ? ` · account ${accountId}` : ''),
    sellerNotConnected:
      'No test seller connected. Without one, the Connect, Pix and card scenarios stay pending in the file.',
    sellerReconnect: "The test seller's connection must be authorized again.",
    connectHint:
      "You will sign in to PagBank's sandbox with a test seller account and approve the consent. Sandbox only.",
    connect: 'Connect test seller',
    reconnect: 'Reconnect test seller',
    connectFailed: 'Could not start the test seller connection.',
    returnedConnected: 'Test seller connected. The callback and the code exchange were recorded in the evidence.',
    returnedFailed: 'The test seller connection did not complete. Try connecting again.',
    generate: 'Generate evidence file\u00a0(TXT and JSON)',
    downloadLatest: 'Download the latest recorded',
    phases: {
      preparing: 'Consulting the application, renewing the token and minting the public key and the 3DS session…',
      encrypting: 'Encrypting the test cards and authenticating the debit card (3DS) in the browser…',
      running: 'Creating the orders in the sandbox — this can take a few minutes…',
      downloading: 'Building the file…',
    },
    steps: {
      label: 'Generation progress',
      names: {
        prepare: 'Prepare (application, token, public key and 3DS session)',
        encrypt: 'Encrypt the cards and authenticate the debit (3DS)',
        PIX: 'Pix',
        CARD: 'Credit card',
        DEBIT: 'Debit with 3DS',
        GOOGLE_PAY: 'Google Pay',
        APPLE_PAY: 'Apple Pay',
        file: 'Build the file',
      },
      walletsInRun: (included, pending) =>
        [
          included.length > 0 ? `In this generation: ${included.join(' and ')}.` : 'No wallet in this generation.',
          pending.length > 0 ? `${pending.join(' and ')} ${pending.length === 1 ? 'stays' : 'stay'} pending.` : '',
        ]
          .filter(Boolean)
          .join(' '),
    },
    summary: ({ executed, failed, pending }) =>
      `✓\u00a0${executed}\u00a0executed · ✗\u00a0${failed}\u00a0failed · ⧗\u00a0${pending}\u00a0pending`,
    incomplete:
      'The file lists what is missing under Pendências. Do not submit it as complete. Notifications that arrive later show up when you download the latest recorded.',
    generateFailed: (phase) =>
      `${
        {
          preparing: 'Consulting the application and preparing the test seller failed.',
          encrypting: 'Encrypting the test cards or authenticating the debit card in the browser failed.',
          running: 'Creating the orders in the sandbox failed.',
          downloading: 'Building the file failed.',
        }[phase]
      } Try again; "Download the latest recorded" still returns what was recorded.`,
    wallets: {
      heading: 'Digital wallets (before generating)',
      names: { GOOGLE_PAY: 'Google Pay', APPLE_PAY: 'Apple Pay' },
      hint: "Tap each wallet before generating; without it, that wallet's section stays pending.",
      googlePayButtonLocale: 'en',
      applePayButton: 'Pay with Apple Pay',
      applePaySheetTotal: 'Homologation test',
      applePayCannotStart: 'Apple Pay is not configured.',
      applePayCannotComplete: 'Apple Pay could not be completed.',
      applePayAbsent: {
        NOT_CONFIGURED: 'Apple Pay: waiting for the Apple Developer account. Its section stays pending.',
        NOT_AVAILABLE: 'Apple Pay: open this screen in Safari on an iPhone or Mac to test it.',
        MERCHANT_VALIDATION_FAILED: "Apple Pay: the merchant validation is not set up. Its section stays pending.",
      },
      googlePayAbsent: 'Google Pay: not configured for this seller. Its section stays pending.',
      ready: (wallet, card) => `${wallet} ready${card ? ` — ${card}` : ''}. It will be used when the file is generated.`,
      failed: (wallet) => `${wallet} returned no token. Tap again to retry.`,
    },
  },
};

/** The production evidence card (FUT-4198). */
export const EN_US_PLATFORM_HOMOLOGACAO_COPY: PlatformHomologacaoCopy = {
  ...BASE,
  productionEvidence: {
    ...BASE.evidence,
    heading: 'Homologation evidence (production)',
    lede:
      "The same scenarios in PagBank's production, with real money: R$ 1.00 each, refunded right after. Nothing is charged before step 3. The file is separate from the sandbox one.",
    sellerHeading: '1. Production seller',
    sellerNotConnected: "No seller connected in production. Connect the platform's PagBank account to generate the production evidence.",
    sellerReconnect: "The production seller's connection needs to be authorized again.",
    connectHint: "You will log in to PagBank's production with the platform's account and approve the consent.",
    connect: 'Connect the production seller',
    reconnect: 'Reconnect the production seller',
    connectFailed: 'Could not start connecting the production seller.',
    returnedConnected: 'Production seller connected. The callback and the code exchange were recorded in the evidence.',
    returnedFailed: "The production seller's connection did not complete. Try connecting again.",
    phases: {
      preparing: 'Consulting the application, renewing the token and minting the public key and the 3DS session…',
      encrypting: "Encrypting the cards and authenticating the debit card (3DS) — follow the bank's challenge if it shows…",
      running: 'Charging R$ 1.00 per scenario and refunding — this can take a few minutes…',
      downloading: 'Building the file…',
    },
    generateFailed: (phase) =>
      `${
        {
          preparing: 'Failed to consult the application and prepare the production seller.',
          encrypting: 'Failed to encrypt the cards or to authenticate the debit card in the browser.',
          running: 'Failed to raise the orders in production.',
          downloading: 'Failed to build the file.',
        }[phase]
      } Try again; "Download the latest recorded" still brings what was recorded.`,
    wallets: {
      ...BASE.evidence.wallets,
      heading: 'Digital wallets',
      hint: 'Tap each wallet before charging; without it, its section stays pending.',
      googlePayAbsent: "Google Pay: waiting for Google's production access. Its section stays pending.",
      applePaySheetTotal: 'PagBank homologation',
    },
    stepper: {
      label: 'Production homologation steps',
      connect: 'Connect the seller',
      data: 'Cardholder and cards',
      charge: 'Charge and refund',
      download: 'Download the file',
      progress: (step, total, label) => `Step ${step} of ${total} · ${label}`,
    },
    buyerHeading: '2. Cardholder and cards',
    buyerHint: 'Sent with the orders and masked in the file. Filled with the last one used in this browser.',
    fields: {
      name: 'Full name',
      taxId: 'CPF or CNPJ',
      email: 'E-mail',
      phone: 'Mobile',
      postalCode: 'Postal code',
      street: 'Street',
      number: 'Number',
      complement: 'Complement',
      city: 'City',
      regionCode: 'State',
    },
    cardsHeading: 'Real cards — encrypted in the browser; the number never reaches the server',
    credit: 'Credit',
    debit: 'Debit (with 3DS)',
    cardFields: { number: 'Card number', expiry: 'MM/YY', securityCode: 'CVV' },
    debitBlankHint: 'Left blank: the debit stays pending in the file.',
    incompleteData: 'Fill in the cardholder and the credit card to charge.',
    pixBlocksCharge: 'Pay or skip the Pix before charging again.',
    scenarios: {
      label: 'Scenarios in this charge',
      names: { credit: 'Credit', debit: 'Debit (3DS)', pix: 'Pix', googlePay: 'Google Pay', applePay: 'Apple Pay' },
      recorded: 'recorded in the file',
      pending: 'pending',
      pix: {
        AWAITING_PAYMENT: 'awaiting payment',
        REFUND_PENDING: 'paid, refunding',
        REFUNDED: 'paid and refunded',
        SKIPPED: 'skipped, pending',
      },
    },
    charge: '3. Charge R$ 1.00 per scenario and refund',
    confirm: {
      title: 'Charge in production?',
      body: 'Up to R$ 5.00 (R$ 1.00 per scenario) will be charged on the cards, the Pix and each wallet tapped, and each refunded right after.',
      typeLabel: 'Type confirmar',
      word: 'confirmar',
      submit: 'Charge and refund',
      cancel: 'Cancel',
    },
    pix: {
      title: 'Pay the R$ 1.00 Pix',
      hint: "Pay it from your bank's app. Once confirmed, it is refunded.",
      expires: (timeLeft) => `Expires in ${timeLeft}`,
      copy: 'Copy code',
      copied: 'Code copied',
      skip: 'Skip the Pix',
      qrAlt: 'R$ 1.00 Pix QR code',
      paid: 'Pix paid and refunded.',
      skipped: 'Pix skipped: it stays pending in the file.',
      refunding: 'Pix paid. Refunding the R$ 1.00…',
    },
    download: '4. Download the production file (TXT and JSON)',
  },
};
