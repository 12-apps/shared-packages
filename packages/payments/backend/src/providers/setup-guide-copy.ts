/**
 * A provider's onboarding walkthrough, in words (FUT-760).
 *
 * The heaviest prose in this package, and the least obviously portable — so
 * the reasoning is worth stating. The STRUCTURE stays with the adapter: how
 * many stages there are, which section a store still owes, which step ends in
 * a confirmation the server cannot observe, and every dashboard URL. That is
 * knowledge of the vendor's onboarding, and holding it is what saves a host
 * from having to learn it.
 *
 * What travels is the prose, because it is prose about a SHOP — "a sua loja",
 * "esta loja não avisa" — and the shop belongs to whoever adopted the package.
 * A host still never writes a walkthrough: it passes a pack, or the pt-BR one.
 *
 * The vendor's own screen names are left INSIDE the sentences rather than
 * lifted into keys. "Desenvolvedores › Chaves de API" is a path the owner
 * reads off Stripe's Portuguese dashboard; a translator working from a German
 * dashboard has to decide what to call it in situ, and a slot would have made
 * that decision for them somewhere else.
 */
export interface StripeSetupGuideCopy {
  stages: {
    /** Step 1 under an authorization — nothing is copied. */
    connectOauth: string;
    /** Step 1 for a store pasting its own keys. */
    connectCredentials: string;
    dashboard: string;
    activate: string;
  };
  /** Step 1, the authorization path. */
  connect: { title: string; intro: string; authorize: string; aboutConnect: string; returns: string };
  /** Step 1, the own-keys path. */
  credentials: {
    title: string;
    intro: string;
    keys: string;
    keysButton: string;
    webhook: string;
    save: string;
  };
  /** Step 2 — the one visit to Stripe's dashboard, closed by hand. */
  dashboard: {
    title: string;
    doneLabel: string;
    doneValue: string;
    intro: string;
    methods: string;
    methodsButton: string;
    tokenization: string;
    tokenizationButton: string;
    payoutsEnabled: string;
    dashboardButton: string;
    /**
     * The webhook sentence, which is the one that cannot serve both paths:
     * under an authorization the endpoint is already registered and the URL is
     * there to be checked; with its own keys the store must create it, and
     * saying "ela já vem configurada" describes work nobody has done.
     */
    webhook(viaGrant: boolean): string;
    confirmLabel: string;
  };
  /** The copy button beside this store's own notification URL. */
  webhookUrlLabel: string;
}

/** Stone/Pagar.me's walkthrough — generate the keys, then register the URL. */
export interface StoneSetupGuideCopy {
  stages: { keys: string; webhook: string; activate: string };
  keys: {
    title: string;
    intro: string;
    generate: string;
    dashboardButton: string;
    paste: string;
    authDocsLink: string;
  };
  webhook: {
    title: string;
    intro: string;
    register: string;
    /**
     * The credentials the Pagar.me dashboard asks for when registering the
     * URL — and the one sentence in this package that says the HOST's name out
     * loud, which is why the platform is a parameter rather than a word.
     */
    credentials(brandName: string): string;
    events: string;
    testConnection: string;
    doneLabel: string;
    doneValue: string;
    confirmLabel: string;
  };
  /** The copy button beside this store's own notification URL. */
  webhookUrlLabel: string;
}

/** InfinitePay's walkthrough — the tag first, the checkout switch second. */
export interface InfinitePaySetupGuideCopy {
  stages: { handle: string; enable: string; activate: string };
  handle: {
    title: string;
    intro: string;
    /** InfinitePay's own warning, repeated above the button that leads there. */
    doNotChange: string;
    /** Whose money it is — named, because there is no undo through the host. */
    wrongTagPaysAStranger(brandName: string): string;
    seeMyTagButton: string;
  };
  enable: {
    title: string;
    intro: string;
    enableStep: string;
    settingsButton: string;
    doneLabel: string;
    doneValue: string;
    /**
     * The notification URL's label here says, in the label itself, that there
     * is nothing to do with it — presenting it as a task is what sent owners
     * hunting for a registration screen InfinitePay does not have.
     */
    webhookUrlLabel: string;
  };
}
