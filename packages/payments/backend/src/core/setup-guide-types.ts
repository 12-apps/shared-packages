/**
 * Provider ONBOARDING descriptors — the normalized shape of a "how to connect
 * your account" walkthrough.
 *
 * Split out of `core/types.ts` because they describe a SCREEN, not a payment:
 * nothing here is ever sent to a provider or persisted with a charge, and the
 * money types should not have to grow past a size limit to make room for
 * copy-button labels. `core/types.ts` re-exports every name below, so this
 * file is an implementation detail — importers are unaffected.
 *
 * `CredentialFieldSpec` lives here for the same reason, having started in the
 * money file: it is a FORM description — a label, whether to mask it, whether
 * to read it back before saving — and nothing in it ever reaches a provider.
 */

/**
 * Declarative description of one credential field a provider needs (api key,
 * public key, webhook secret, ...). Hosts render their credential forms and
 * validate stored blobs from this — the library defines WHAT is needed, the
 * host decides WHERE it is stored (encrypted at rest, per merchant).
 */
export interface CredentialFieldSpec {
  key: string;
  label: string;
  /** Secrets are write-only in UIs (masked hints, never echoed back). */
  secret: boolean;
  /** Required to enable the provider (vs optional extras). */
  required: boolean;
  /**
   * What this field IS to the platform, beyond a string to store (FUT-761).
   * `webhookSecret` marks the field whose value authenticates INBOUND
   * deliveries for this provider — the fact hosts used to keep as a
   * hand-written provider→field table, which is only ever wrong silently.
   */
  role?: 'webhookSecret';
  /** Monospace + letter-spaced: `$loja-l0ja` and `$loja-loja` are the same
   * shape in a proportional face, and a wrong handle is not an error — it is
   * somebody else's account. */
  mono?: boolean;
  /** Quote the value back before writing it. For the field that decides WHERE
   * THE MONEY GOES: one short string, no checksum, and nothing between a typo
   * and a stranger being paid irreversibly except the owner re-reading it. */
  confirmOnSave?: boolean;
  /** Greyed example inside the empty input, e.g. `$suatag`. */
  placeholder?: string;
  /** The line under the input — how to check the value, not what it is for. */
  helperText?: string;
  /**
   * Source of a `RegExp` the value must match before it can be saved.
   *
   * Shape only: it cannot know whether an account exists, which is what the
   * probe run straight after the save is for. But `$` plus a few safe
   * characters is free to check, and it keeps the ordinary slips out of a
   * confirmation dialog that would otherwise ask the owner to vouch for them.
   */
  pattern?: string;
  /**
   * Key of another STORED field whose value satisfies this one when the field
   * itself is empty — read-side only; writes and clears still address `key`.
   *
   * Exists for OAuth. An authorization stores its tokens under the flow's own
   * names (Stripe's `accessToken`), never under the schema key an owner would
   * have pasted (`secretKey`) — deliberately, so a reconnect can never leave a
   * stale pasted key outranking the fresh grant. But the masked settings view
   * is built from this schema, so without the mapping a connected store read
   * `configured: false` on every field: a screen claiming "nothing here" about
   * the very connection it charges through (FUT-691). The adapter declares the
   * bridge; no consumer has to know a provider's token vocabulary.
   */
  fulfilledBy?: string;
}

/** A labelled external link rendered inline within a setup step. */
export interface SetupLink {
  label: string;
  url: string;
}

/** Ready-to-paste text for a provider dashboard field (copy button). */
export interface SetupCopy {
  label: string;
  text: string;
  /**
   * Start folded away, behind its own label.
   *
   * For a value the owner does NOT have to act on. InfinitePay reads its
   * `webhook_url` from the charge payload, so the notification URL is pure
   * reference — and printed as a full-width field with a copy button it was the
   * most prominent thing on the step, which is how owners came to hunt for a
   * registration screen that does not exist.
   */
  collapsible?: boolean;
}

/**
 * How loudly a step reads — see `SetupStep.tone`.
 *
 * `warning` is not decoration. A walkthrough's numbered steps are a sequence of
 * things to DO, and the two sentences that matter most in InfinitePay's — the
 * tag decides whose account gets the money, and the page we link to can also
 * change it — are things NOT to do. Printed as steps 2 and 3 they looked like
 * further instructions, below the button that had already taken the owner to
 * the risky page. A toned step renders as a callout with no number, so it can
 * sit ABOVE the button it is warning about without pretending to be an action.
 */
/** One actionable walkthrough instruction. */
export interface SetupStep {
  /**
   * Optional, because a step can BE the control it carries. "Copie a sua
   * InfiniteTag — ela aparece no canto superior esquerdo do app, e também na
   * página abaixo" is a sentence spent describing a button that is right there
   * and already says what it does.
   */
  text?: string;
  /** Omit for an ordinary numbered instruction. */
  tone?: 'warning';
  /** Primary action: the external page this step happens on. */
  button?: SetupLink;
  /** Secondary reference (docs) — rendered as a plain link. */
  link?: SetupLink;
  copy?: SetupCopy;
  /**
   * An IN-APP action the host performs on the merchant's behalf, identified by
   * an opaque id the adapter and the host agree on (PagBank's
   * `homologacao-anexo` generates the evidence file the review form demands).
   * The package neither knows nor cares what it does: the settings component
   * renders a button and calls the host's handler. A host with no handler for
   * the id simply renders no button — the step's text still reads correctly.
   */
  action?: string;
}

/** A titled group of steps in the onboarding walkthrough. */
export interface SetupSection {
  id: string;
  title: string;
  intro?: string;
  steps: SetupStep[];
  /**
   * How this section reads once it is DONE — a label and the fact it records,
   * for the one-line row it collapses into.
   *
   * Authored by the adapter rather than derived from `title`, because the two
   * say different things: the title is an instruction ("Habilitar o Checkout
   * Integrado") and this is a state ("Habilitado na conta InfinitePay"). A row
   * that still reads as a command looks like a step outstanding.
   */
  doneSummary?: { label: string; value: string };
  /**
   * The confirm button's copy, for a section ending in a question only the
   * owner can answer (the step carrying the confirmation `action`).
   *
   * The label used to be a constant in the renderer — "Já habilitei o Checkout
   * Integrado" — written for the one guide that had a confirmable section, and
   * NAMING ANOTHER VENDOR'S PRODUCT on every other provider's screen. That
   * confirmation is the only mechanism a guide has for advancing past a step no
   * API can report, so every provider with such a step needs one, and each is
   * asking about something different: Stripe's dashboard, Stone's webhook
   * registration, InfinitePay's Checkout Integrado.
   *
   * Absent, the renderer falls back to that original string — so InfinitePay's
   * guide is unchanged, byte for byte.
   */
  confirmLabel?: string;
}

/** One stage of the provider onboarding stepper (connect → verify → sell). */
export interface OnboardingStage {
  id: string;
  label: string;
}

/**
 * The provider's step-by-step setup screen, normalized — the reusable
 * equivalent of the PagBank "Como gerar o token e cadastrar as URLs"
 * walkthrough. Rendered by the frontend package; each adapter authors its
 * own content (per-merchant URLs arrive via {@link SetupGuideContext}).
 */
export interface ProviderSetupGuide {
  stages: OnboardingStage[];
  sections: SetupSection[];
  /**
   * Index into `stages` of the step the merchant is actually on.
   *
   * The adapter decides this for the same reason it decides which section to
   * show: they are two views of one fact, and split between two owners they
   * drift. They did — the stepper defaulted to 0 and sat on "Informar
   * InfiniteTag" while the screen below it rendered the step-3 charge card.
   *
   * `stages.length` means every step is done. Omitted means "unknown", which
   * renders as the first step, exactly as before this field existed.
   */
  activeStage?: number;
  /**
   * The same walkthrough for a store connecting with its OWN keys.
   *
   * A provider that accepts both a grant and pasted credentials has ONE screen
   * and two genuinely different first steps. Written as a single guide, step 1
   * said "clique em 'Conectar com Stripe' acima" to an owner who had opened the
   * credential form — where that button is not rendered, because it acts on a
   * grant they are not using. The rest of the walkthrough (configure the
   * account, then charge to activate) really is shared, which is why this is a
   * variant of one guide rather than two unrelated ones.
   *
   * Omitted when a provider's steps do not depend on how it was connected —
   * both paths then render the base guide, unchanged.
   *
   * **It must MIRROR the base guide's shape**: the same number of stages, with
   * the owner-confirmable section at the same index. The host resolves the
   * activation card's `blocked`/`hidden` from the base guide alone — that
   * happens before the panel knows which path is open — so a variant that moved
   * either would desync the step that switches the store on from the
   * walkthrough above it. Pinned by the guide invariant tests.
   */
  credentialsPath?: SetupPathVariant;
}

/** A walkthrough variant: every part of a guide except its alternatives. */
export type SetupPathVariant = Omit<ProviderSetupGuide, 'credentialsPath'>;

/**
 * Host-computed, merchant-specific values interpolated into setup guides.
 *
 * Deliberately small: these are the facts ONLY the host knows (where its
 * webhooks land, what the merchant is called). Everything else about a
 * walkthrough — wording, ordering, dashboard links, which review forms a
 * vendor requires — belongs to the adapter, so a host never has to learn a
 * provider's onboarding to render it.
 */
export interface SetupGuideContext {
  /**
   * What the HOST PLATFORM is called, in the owner's own words — the name a
   * store owner would recognise on the screen they are reading.
   *
   * REQUIRED, and deliberately not defaulted. Two guides address the platform
   * by name in the middle of an instruction ("é assim que o {brandName}
   * confirma que a notificação veio mesmo da Stone"), and until this existed
   * those sentences carried ONE adopter's product name, shipped inside a
   * package every other adopter installs. A default would preserve that
   * failure rather than fix it: a host that says nothing would silently ship
   * a stranger's brand to its own store owners, and nothing would fail. A
   * required field makes a new host answer the question once, loudly, at the
   * single call site that knows the answer.
   */
  brandName: string;
  /** This merchant's webhook/notification URL for the provider. */
  webhookUrl: string;
  /** Optional extra URL some providers require (e.g. public-key service). */
  publicKeyUrl?: string;
  /**
   * The merchant's display name, for provider review forms that ask what is
   * being sold and by whom (PagBank's homologação is the live example).
   */
  merchantName?: string;
  /** The merchant's public storefront — what a provider reviewer visits. */
  storefrontUrl?: string;
  /**
   * How far this merchant already is, so a guide can show only what is LEFT.
   *
   * A walkthrough that prints all of its stages whatever the store has done
   * makes the owner find their own place in it every time they open the
   * screen — and the step they still owe looks exactly like the two they
   * finished. Adapters use this to drop the sections that are already true.
   *
   * Optional, and every field defaults to "not done": a host that supplies
   * nothing gets the whole guide, which is what every caller got before this
   * existed.
   */
  progress?: SetupProgress;
}

/** What is already true of a merchant's connection, from the host's records. */
export interface SetupProgress {
  /**
   * Which credential fields hold a value, keyed exactly as the adapter's
   * `credentialSchema` names them, for the environment being set up.
   */
  configured: Readonly<Record<string, boolean>>;
  /** The credential probe has passed (`VERIFIED`/`RECONNECT_REQUIRED`). */
  connected: boolean;
  /** A real charge has gone through — the provider may be switched on. */
  proven: boolean;
}
