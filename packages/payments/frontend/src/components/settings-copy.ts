/**
 * Every sentence the payments SETTINGS surface puts in front of a store owner
 * (FUT-760).
 *
 * Required, with no defaults — this package's own doctrine, stated in
 * `checkout/view-copy.ts`: a default in the origin host's language reads as
 * finished to the next host right up until an owner sees it.
 *
 * The split is the one the whole port draws. WHICH state the connection is in
 * — authorized but unverified, verified and paused, an authorization about to
 * expire, an environment that moves real money — is knowledge of the payments
 * lifecycle, and it stays here. The words are the host's.
 *
 * ## What is NOT in here
 *
 * The provider's own display name. It arrives as `displayName` from the
 * adapter and is interpolated by the functions below, because "PagBank" is
 * PagBank's name in every language.
 *
 * The dates. `Autorização válida até {when}` takes an already-formatted
 * string, since how a host formats a date is a host decision it has already
 * made elsewhere.
 */

/** The chip and the two lines under it — where this connection stands. */
export interface ConnectionStatusCopy {
  /** A real charge has gone through — the strongest thing the chip can say. */
  verified: string;
  /** Nothing has been proven about this connection yet. */
  unverified: string;
  /** The credential probe passed; no charge has been made. */
  connectionOk: string;
  /**
   * A connection that WAS working and stopped — the one red chip, because it
   * is news rather than a step still to finish.
   */
  reconnectRequired: string;
  /** Not connected at all. */
  notConnected: string;
  /** The lead line before the three steps, for a provider not yet receiving. */
  threeStepsAhead: string;
  /** The same, when the store must connect and verify first. */
  connectAndVerifyFirst: string;
  /** Live: this provider is taking money. */
  receiving: { state: string; sub: string };
  /** Proven, and switched off by the owner. */
  pausedByOwner: { state: string; sub: string };
  /** The chip above that pair. */
  pausedChip: string;
  /** Proven, not switched on yet. */
  readyNotReceiving: { state: string; sub: string };
}

/**
 * The provider LIST's badge — one word per row, and a different vocabulary
 * from the panel's chip on purpose: the list answers "where does this store
 * stand" and the panel answers "what is left to do".
 */
export interface ConnectionBadgeCopy {
  /** Money can move through this provider right now. */
  active: string;
  /** Connected and proven, but not switched on. */
  connected: string;
  /** It was working and stopped. */
  reconnect: string;
  notConnected: string;
}

/** The environment tabs, and what choosing one means. */
export interface EnvironmentCopy {
  /** The two environments' names, as this host says them. */
  production: string;
  sandbox: string;
  /** The tab group's own label (and its `aria-label`). */
  groupLabel: string;
  /** The line under the tabs: which environment, and what it costs. */
  productionMeaning: string;
  sandboxMeaning: string;
  productionConsequence: string;
  sandboxConsequence: string;
  /**
   * The store is CURRENTLY charging in the other environment — the sentence
   * that stops an owner editing sandbox keys believing they are live.
   */
  storeIsUsing(environmentName: string): string;
}

/** The OAuth half: connecting by authorization rather than by pasted keys. */
export interface OAuthConnectionCopy {
  connectAction(displayName: string): string;
  /** The same button once a connection exists — a re-grant, not a first one. */
  reconnectAction: string;
  /** Drop the connection entirely. */
  removeAction: string;
  /** The invitation, before anything is connected. */
  invitation(displayName: string): string;
  /** How long it takes and where the owner goes. */
  roundTripNote: string;
  /** Connected: what the authorization does and does not give us. */
  connectedExplainer: string;
  connectedNote(displayName: string): string;
  connectedAt(when: string): string;
  /** The authorization is still good, until this moment. */
  validUntil(when: string): string;
  /** It has already lapsed. */
  expiredAt(when: string): string;
  /** It lapses soon. */
  expiresAt(when: string): string;
  /** It lapsed or was revoked at the provider. */
  revoked: string;
  /**
   * This DEPLOYMENT registered no OAuth application, so the button cannot
   * work — the one sentence here about the installation rather than the store.
   */
  notAvailableHere(displayName: string): string;
  /**
   * The whole PANEL's refusal, for a deployment with no registered provider
   * application at all.
   *
   * Not the same sentence as {@link notAvailableHere}: that one sits beside a
   * working credential form and points at it, this one replaces the connect
   * card because there is no button to render.
   */
  connectUnavailable: string;
  /** The two links that swap between the grant and the credential form. */
  preferOAuth: string;
  preferCredentials: string;
  /** What the grant lets this platform do, listed by scope. */
  scopes: {
    read: string;
    create: string;
    refund: string;
    account: string;
  };
}

/** The connection card, and the confirmation that removes it. */
export interface ConnectionCardCopy {
  accountHeading(displayName: string): string;
  /** The fact rows' own labels, down the left of the card. */
  accountLabel: string;
  connectionLabel: string;
  authorizedAt(displayName: string): string;
  environmentLabel: string;
  connectedAtLabel: string;
  /**
   * Sandbox, as this card names it — the parenthetical is here and not in
   * `EnvironmentCopy` because the tabs label a CHOICE and this labels a fact.
   */
  sandboxWithNote: string;
  /** The three steps a grant takes, for a store that has not connected yet. */
  steps: { signIn(displayName: string): string; authorize: string; comeBack: string };
  removeAction: string;
  removeQuestion(displayName: string): string;
  /**
   * What removing costs. Two sentences, because a LIVE connection stops the
   * store taking money the moment it goes — and that is not the same warning
   * as "you can reconnect later".
   */
  removeConsequenceLive: string;
  removeConsequenceIdle: string;
  /**
   * The first itemised consequence, shown only for a LIVE connection: the
   * store stops taking money the moment this is confirmed.
   *
   * Its own field rather than a clause of `removeConsequenceLive`, because
   * the list beside it is what makes the irreversible item weigh more than
   * the reversible ones — a single paragraph is what an owner skims.
   */
  removeStopsChargingNow: string;
  removeRevokes(displayName: string): string;
  removeKeepsSettled(displayName: string): string;
  removeRestartsSetup: string;
  /**
   * The way out of the removal dialog for an owner who only meant to stop
   * taking orders — the offer that makes the destructive button safe to show.
   */
  pauseInstead: string;
  /** The dialog's plain dismiss, under the two offers above. */
  cancel: string;
}

/** The credential form: its fields, its probe, and what it says while testing. */
export interface CredentialFormCopy {
  /** A stored secret, shown masked — leaving it blank keeps it. */
  configuredKeepBlank: string;
  /** The suffix on an `advanced` field most stores must leave empty. */
  advancedSuffix: string;
  probeAction: string;
  /**
   * What replacing a PROVEN connection's credentials costs.
   *
   * Takes the provider's display name: the sentence used to name "InfiniteTag"
   * outright, and it renders above EVERY provider's credential form — so a
   * Stripe store was told to be careful with a field it does not have. Rendered
   * through `richText`, so `**…**` marks the two clauses that carry the cost.
   */
  reverifyWarning(displayName: string): string;
  probeRunning: string;
  probeSaveNote: string;
  probeIncompleteNote: string;
  probeFailed(environmentName: string): string;
  /** The per-credential marks beside each field. */
  checkPass: string;
  checkFail: string;
  /** A credential the provider offers no way to check. */
  uncheckable: string;
  /**
   * The save button's three forms. WHICH one is right is a fact this package
   * establishes — a complete set is sent to the provider, a partial one is
   * only written down, and a one-field provider names its field instead.
   */
  saveAndTest: string;
  save: string;
  saveOnly(fieldLabel: string): string;
  /** Reopen a finished credential step — unaccented, so only a reading found it. */
  changeAction: string;
}

/** Ordering the provider chain, and what a decline does at the end of it. */
export interface ProviderPriorityCopy {
  moveUp(label: string): string;
  moveDown(label: string): string;
  saveFailed: string;
  /** The head of the chain, captioned so the order is unmistakable. */
  firstInChain: string;
  /** The reorderable list's own heading. */
  orderHeading: string;
  /**
   * What the order MEANS, naming the provider at the head of it.
   *
   * Rendered through `richText`, so `**…**` marks that name — the sentence is
   * about which provider is tried first, and the name is the answer.
   */
  chainExplainer(firstProviderLabel: string): string;
  /** No provider is switched on, so nothing can be charged at all. */
  noneActive: string;
  /**
   * The switch's label. Rendered through `richText`, so `**…**` emphasises the
   * word the sentence is about — the same two-asterisk grammar the setup-guide
   * steps use, and the only markup any copy in this package may carry.
   */
  retryDeclinedLabel: string;
  retryDeclinedOn: string;
  retryDeclinedOff: string;
}

/** Choosing which provider to set up, before there is a connection at all. */
export interface ProviderListCopy {
  heading: string;
  /** What choosing one means — the setup that follows is shaped by it. */
  subheading: string;
}

/**
 * The last look at the value that decides who gets paid.
 *
 * A mistyped account handle is the one failure on this screen with no
 * recourse: the charge succeeds, the buyer is happy, and the money is in a
 * stranger's account. So these sentences are not decoration, and a host that
 * softens them has removed the only intervention available.
 */
export interface ConfirmCredentialSaveCopy {
  title: string;
  /**
   * What saving this value means, naming the field it will be saved as — the
   * provider's own name for it, as the credential schema spells it.
   */
  body(fieldLabel: string): string;
  /** What to call the field when the schema shipped no label for it. */
  fieldFallback: string;
  /** The irreversibility, said plainly and last. */
  warning: string;
  /** Cancel is the plain, first-reached option; confirm carries the verb. */
  cancelAction: string;
  confirmAction: string;
}

/** The walkthrough's own controls — the confirmation only an owner can give. */
export interface SetupGuideCopy {
  /**
   * The fallback confirm label, for a guide whose section declares none.
   *
   * It names another vendor's product ("Checkout Integrado"), which is why a
   * section that can say something truer declares `confirmLabel` itself.
   */
  defaultConfirmLabel: string;
  /** How a confirmed section reads once it has collapsed. */
  confirmedByYou: string;
  /** Reopen a section the owner already confirmed. */
  reviewAction: string;
  /**
   * The sentence beside the confirm button. It exists because the owner is
   * vouching for work done in the PROVIDER's dashboard, not here — a bare
   * button gives them nothing to weigh that against.
   */
  confirmPrompt: string;
  /**
   * The copy-to-clipboard button beside a reference value, and what it says
   * for the two seconds after a successful copy.
   */
  copyValue(fieldLabel: string): string;
  copied: string;
}

/** The whole settings surface, in one object a host passes at the mount. */
export interface PaymentsSettingsCopy {
  status: ConnectionStatusCopy;
  listBadge: ConnectionBadgeCopy;
  environment: EnvironmentCopy;
  oauth: OAuthConnectionCopy;
  card: ConnectionCardCopy;
  credentials: CredentialFormCopy;
  priority: ProviderPriorityCopy;
  providerList: ProviderListCopy;
  confirmSave: ConfirmCredentialSaveCopy;
  setupGuide: SetupGuideCopy;
}
