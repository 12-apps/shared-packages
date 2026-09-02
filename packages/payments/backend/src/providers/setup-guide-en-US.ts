import type {
  InfinitePaySetupGuideCopy,
  StoneSetupGuideCopy,
  StripeSetupGuideCopy,
} from './setup-guide-copy';

/**
 * The en-US walkthroughs for the adapters that ship one — NAMED constants a
 * host passes by hand, never a default.
 *
 * Kept apart from `en-US.ts` for the reason `setup-guide-pt-BR.ts` records:
 * these are the longest strings in the package by an order of magnitude, and
 * whoever writes a walkthrough is doing a different job from whoever names a
 * credential field.
 *
 * Every MENU PATH is quoted in the vendor's own words — "Developers › API
 * keys", "Settings › Payment methods", "Sales › Checkout" — because that is
 * what the owner has to find on a screen this package does not control. So are
 * the key prefixes, the event names (`charge.paid`, …) and the error string
 * Stripe itself returns. A translated menu path is a walkthrough that cannot be
 * followed.
 */
export const EN_US_STRIPE_SETUP_GUIDE_COPY: StripeSetupGuideCopy = {
  stages: {
    connectOauth: 'Connect account',
    connectCredentials: 'Enter the keys',
    dashboard: 'Configure in Stripe',
    activate: 'Start selling',
  },
  connect: {
    title: 'Step 1 · Connect your Stripe account',
    intro:
      'The connection is made by authorising it on Stripe\'s own site — you copy no keys, and you can revoke access whenever you like, from the Stripe dashboard or the “Disconnect” button here. Prefer to use your own keys? Open “I would rather enter the credentials myself” below: the walkthrough switches to that route.',
    authorize:
      'Click “Connect with Stripe” above. You will be taken to Stripe to sign in and authorise access. If you do not have an account yet, you can create one along the way.',
    aboutConnect: 'About Stripe Connect',
    returns:
      'Once you authorise it, you come back to this page automatically and the connection shows as “Connected”.',
  },
  credentials: {
    title: 'Step 1 · Enter your own Stripe keys',
    intro:
      'You are connecting with **your own keys**. They are stored for this store, and the environment chosen above (Sandbox or Production) decides which Stripe account they have to come from — test keys do not work in production.',
    keys: 'In the Stripe dashboard, open “Developers › API keys” and copy the **Secret key** (`sk_...`) and the **Publishable key** (`pk_...`).',
    keysButton: 'Open API keys',
    webhook:
      'Under “Developers › Webhooks”, create an endpoint pointing at this store\'s notification URL and copy the **Signing secret** (`whsec_...`) Stripe shows when you create it. Without it, an approved payment is never confirmed here.',
    save: 'Paste the keys into the form below and click “Save and test connection”. They are sent to Stripe immediately, and the result for each one appears right after.',
  },
  dashboard: {
    title: 'Step 2 · Configure your Stripe account',
    doneLabel: 'Stripe account',
    doneValue: 'Configured by you',
    intro:
      'Stripe only processes PIX and boleto if those methods are enabled on **your own** account — authorising the connection does not turn them on for you.',
    methods:
      'In the Stripe dashboard, open “Settings › Payment methods” and enable PIX and Boleto for your Brazilian account.',
    methodsButton: 'Open payment methods',
    tokenization:
      'Open “Settings › Integration” and enable card tokenisation with a publishable key. New accounts have it off, and without it Stripe refuses the Step 3 test charge with “integration surface is unsupported”.',
    tokenizationButton: 'Open integration settings',
    payoutsEnabled:
      'Check that your account is enabled to receive payments — Stripe asks for company documents before releasing payouts.',
    dashboardButton: 'Open the Stripe dashboard',
    webhook: (viaGrant) =>
      viaGrant
        ? 'This store\'s notification URL is below. Connecting by authorisation configures it for you — copy it only if you would rather register an endpoint of your own under “Developers › Webhooks”.'
        : 'Check that the endpoint you created under “Developers › Webhooks” points at this store\'s notification URL, below. With your own keys this registration is yours — without it Stripe never tells this store when a payment is approved.',
    confirmLabel: 'I have configured my Stripe account',
  },
  webhookUrlLabel: 'Notification URL',
};

export const EN_US_STONE_SETUP_GUIDE_COPY: StoneSetupGuideCopy = {
  stages: { keys: 'Generate keys', webhook: 'Register the webhook', activate: 'Start selling' },
  keys: {
    title: 'Generate your API keys',
    intro:
      'Stone processes online payments through the Pagar.me platform (Stone\'s own technology) — which is why the keys are generated in the Pagar.me dashboard, with the same Stone account.',
    generate:
      'Open the dashboard and go to “Settings › Keys”. Copy the public key (pk_...) and generate the secret key (sk_...).',
    dashboardButton: 'Open the dashboard',
    paste:
      'Paste both keys into the form above. Use the test keys while you are in the Sandbox environment, and the production ones only once you have validated it.',
    authDocsLink: 'Authentication documentation',
  },
  webhook: {
    title: 'Register the notification URL',
    intro:
      'Without a webhook, a paid PIX is only noticed when the screen polls for status — the order can take a while to confirm.',
    register: 'In the dashboard, open “Settings › Webhooks” and register this store\'s URL:',
    // `brandName` is the HOST's own name, interpolated: the sentence is about
    // who verifies the notification, and that is the adopter, not this package.
    credentials: (brandName) =>
      `When you register it, the dashboard asks for a username and a password to authenticate the notifications. Set both and enter exactly the same values in the form above — that is how ${brandName} confirms a notification really came from Stone.`,
    // Event names are the vendor's own identifiers, not words.
    events: (eventList) => `Subscribe to at least these charge events: ${eventList}.`,
    testConnection:
      'Once that is done, click “Test connection” above: the test makes a real authenticated call and tells you if the key is wrong.',
    doneLabel: 'Webhook',
    doneValue: 'Registered in the Pagar.me dashboard',
    confirmLabel: 'I have registered the URL in the dashboard',
  },
  webhookUrlLabel: 'Notification URL',
};

export const EN_US_INFINITEPAY_SETUP_GUIDE_COPY: InfinitePaySetupGuideCopy = {
  stages: {
    handle: 'Enter the InfiniteTag',
    enable: 'Enable Checkout',
    activate: 'Start selling',
  },
  handle: {
    title: 'Step 1 · Enter your InfiniteTag',
    intro:
      'InfinitePay identifies your account by its InfiniteTag — the same @ shown at the top of the app. There is no API key to copy.',
    doNotChange:
      'The InfinitePay page also lets you **change** the tag — do not. Changing the InfiniteTag breaks your charges, your online store and any payment links already sent, which then have to be reissued.',
    // The sharpest sentence in the package, and the emphasis is load-bearing:
    // a wrong tag sends this store's money to a stranger, irreversibly.
    wrongTagPaysAStranger: (brandName) =>
      `The InfiniteTag decides **which account** the money reaches. A wrong tag sends this store's payments to somebody else, and ${brandName} cannot reverse it — check it character by character.`,
    seeMyTagButton: 'See my InfiniteTag',
  },
  enable: {
    title: 'Step 2 · Enable Integrated Checkout',
    intro:
      'On InfinitePay accounts, Integrated Checkout is **off** by default. Without it no payment link is created — even with the right InfiniteTag.',
    enableStep:
      'In the InfinitePay app: **Sales › Checkout › Settings › Enable Integrated Checkout**.',
    settingsButton: 'Open the checkout settings',
    doneLabel: 'Integrated Checkout',
    doneValue: 'Enabled on the InfinitePay account',
    webhookUrlLabel: 'Notification URL (you do not need to register it)',
  },
};
