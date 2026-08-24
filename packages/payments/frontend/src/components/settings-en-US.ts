import type { PaymentsSettingsCopy } from './settings-copy';

/**
 * The en-US pack for the payments settings surface — a NAMED constant a host
 * passes by hand, never a default.
 *
 * The four sentences that matter most on this screen are the ones about MONEY
 * MOVING, and the translation keeps each of them blunt rather than polite:
 *
 *  - `confirmSave.warning` — a wrong value pays a stranger, irreversibly;
 *  - `card.removeConsequenceLive` — removing a live connection stops the store
 *    taking money immediately;
 *  - `priority.noneActive` — with nothing active the checkout cannot charge;
 *  - `credentials.reverifyWarning` — changing credentials stops collection
 *    until re-verification finishes.
 *
 * `**bold**` markers are the surface's own emphasis and survive translation, on
 * the phrase that carries the consequence.
 */
export const EN_US_PAYMENTS_SETTINGS_COPY: PaymentsSettingsCopy = {
  status: {
    verified: 'VERIFIED',
    unverified: 'NOT VERIFIED',
    connectionOk: 'CONNECTION OK',
    reconnectRequired: 'RECONNECT',
    notConnected: 'Not connected',
    threeStepsAhead: 'This provider only starts taking sales after the 3 steps below.',
    connectAndVerifyFirst: 'Connect and verify the provider before switching sales on.',
    receiving: {
      state: 'Taking sales',
      sub: 'Your store is being paid through this provider.',
    },
    pausedByOwner: {
      state: 'Paused',
      sub: 'Connection ready and paused by you — no new order is charged here.',
    },
    pausedChip: 'Paused',
    readyNotReceiving: {
      state: 'Not taking sales yet',
      sub: 'Everything is ready — flip the switch to start taking payments.',
    },
  },
  listBadge: {
    active: 'Active',
    connected: 'Connected',
    reconnect: 'Reconnect',
    notConnected: 'Not connected',
  },
  environment: {
    production: 'Production',
    sandbox: 'Sandbox',
    groupLabel: "This connection's environment",
    productionMeaning: 'Production — real money.',
    sandboxMeaning: 'Sandbox — a test environment.',
    productionConsequence: "Everything you do here applies to the store's real sales.",
    sandboxConsequence: 'No money actually moves.',
    // Leading space: it is appended to one of the sentences above.
    storeIsUsing: (environmentName) => ` The store is currently using ${environmentName}.`,
  },
  oauth: {
    connectAction: (displayName) => `Connect with ${displayName}`,
    reconnectAction: 'Reconnect',
    removeAction: 'Remove connection',
    invitation: (displayName) =>
      `Connect your ${displayName} account by authorising access on the provider's site. No keys to copy.`,
    roundTripNote: 'You go out to the provider and come back here — it takes under a minute.',
    connectedExplainer:
      'Your account is connected. Charges are created on your behalf — no keys to copy.',
    connectedNote: (displayName) =>
      `${displayName} account connected. Revoke it whenever you like, here or in the provider's dashboard.`,
    connectedAt: (when) => `Connected ${when}`,
    validUntil: (when) => `Authorisation valid until ${when}`,
    expiredAt: (when) =>
      `The authorisation expired on ${when}. Reconnect to start taking payments again.`,
    expiresAt: (when) =>
      `The authorisation expires on ${when}. If the warning stays, reconnect the account.`,
    revoked:
      'The authorisation expired or was revoked. Reconnect to start taking payments again.',
    notAvailableHere: (displayName) =>
      `Connecting to ${displayName} automatically is not available in this installation — ` +
      'the authorisation application has not been registered. To connect now, open ' +
      '“I would rather enter the credentials myself” below and paste your own keys.',
    connectUnavailable:
      'This provider connects by authorisation, but the connect button is not available in this ' +
      'installation. You can still connect by entering the credentials yourself.',
    preferOAuth: 'I would rather connect by authorisation',
    preferCredentials: 'I would rather enter the credentials myself',
    // What the owner is granting, shown before they authorise.
    scopes: {
      read: 'Look up payments',
      create: 'Create charges',
      refund: 'Refund payments',
      account: 'Look up account details',
    },
  },
  card: {
    accountHeading: (displayName) => `${displayName} account`,
    accountLabel: 'Account',
    connectionLabel: 'Connection',
    authorizedAt: (displayName) => `Authorised on ${displayName}`,
    environmentLabel: 'Environment',
    connectedAtLabel: 'Connected',
    sandboxWithNote: 'Sandbox (testing)',
    steps: {
      signIn: (displayName) =>
        `Sign in to your ${displayName} account — you can create one on the spot if you do not have one.`,
      authorize: "Authorise access on the provider's screen.",
      comeBack: 'You come back here with the account connected.',
    },
    removeAction: 'Remove connection',
    removeQuestion: (displayName) => `Remove the connection to ${displayName}?`,
    removeConsequenceLive:
      'The store stops taking payments immediately and is left with no active provider — new orders cannot be paid until you connect another.',
    removeConsequenceIdle: 'This connection leaves the store. You can connect again later.',
    removeStopsChargingNow: 'New orders stop being charged immediately.',
    removeRevokes: (displayName) =>
      `The authorisation is revoked at ${displayName}. Your account and its history stay there, untouched.`,
    removeKeepsSettled: (displayName) =>
      `Payments already approved and refunds in flight carry on as normal through ${displayName}.`,
    removeRestartsSetup: 'To reconnect, the steps start again from the beginning.',
    pauseInstead: 'Just pause taking payments',
    cancel: 'Cancel',
  },
  credentials: {
    configuredKeepBlank: 'Configured — leave blank to keep the current value.',
    // Leading space: it is appended to a field label.
    advancedSuffix: ' · Connect platforms only',
    probeAction: 'Test connection',
    reverifyWarning: (displayName) =>
      `This store is already verified. Changing the credentials **requires re-verification** ` +
      `and the store **stops taking payments** through ${displayName} until it finishes.`,
    probeRunning: 'Testing the connection…',
    probeSaveNote: 'We save and test the keys with the provider before going on.',
    probeIncompleteNote: 'We kept what you have filled in. Complete the fields to test.',
    probeFailed: (environmentName) =>
      `Could not connect in ${environmentName}. Check the credentials for this environment.`,
    checkPass: 'Verified',
    checkFail: 'Fix',
    uncheckable: 'Not verifiable',
    saveAndTest: 'Save and test connection',
    save: 'Save',
    saveOnly: (fieldLabel) => `Save ${fieldLabel}`,
    changeAction: 'Change',
  },
  priority: {
    moveUp: (label) => `Move ${label} up`,
    moveDown: (label) => `Move ${label} down`,
    saveFailed: 'Could not save the order.',
    firstInChain: 'first',
    orderHeading: 'Order of attempts',
    chainExplainer: (firstProviderLabel) =>
      `Checkout tries **${firstProviderLabel}** first. If a charge fails for a technical ` +
      'reason it tries the next in the list — but only when it can prove the previous ' +
      'attempt did not charge anything.',
    noneActive:
      'No provider is active. Checkout will not be able to charge until you switch at least one on.',
    retryDeclinedLabel: 'Retry a **declined** card with the next provider',
    // Both sides of the switch say what it COSTS, which is the point of the
    // pair: one names the risk, the other names the default.
    retryDeclinedOn:
      'A decline moves on to the next in the list. This can raise transaction costs and fraud signals.',
    retryDeclinedOff:
      'Default: a decline ends the charge. Only technical failures move on to the next.',
  },
  providerList: {
    heading: 'Choose the payment provider',
    subheading: 'Pick where your store is paid — the setup is tailored to it.',
  },
  confirmSave: {
    title: 'Confirm where the money goes',
    body: (fieldLabel) =>
      `Every payment this store takes will be deposited into the account this ${fieldLabel} belongs to:`,
    fieldFallback: 'credential',
    warning:
      "A wrong value sends this store's payments to somebody else, and there is no way to reverse it.",
    cancelAction: 'Go back and check',
    confirmAction: "That's the one, save it",
  },
  setupGuide: {
    defaultConfirmLabel: 'I have enabled Integrated Checkout',
    confirmedByYou: 'Confirmed by you',
    reviewAction: 'Review',
    confirmPrompt: "Confirm once you have finished on the provider's side.",
    copyValue: (fieldLabel) => `Copy ${fieldLabel}`,
    copied: 'Copied',
  },
};
