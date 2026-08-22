/**
 * Every owner-facing sentence the four built-in adapters can produce, as ports
 * (FUT-760).
 *
 * The split is the same one `CheckoutCopy` and `ActivationCopy` already draw.
 * WHICH situation the owner is in — a key that authenticates but cannot charge,
 * a publishable key from the other mode, an InfiniteTag that resolves to
 * nobody, a provider that never answered — is knowledge of that vendor's API,
 * and it is exactly what an adapter exists to hold. The WORDS are the host's.
 *
 * Passed to the provider factory, so choosing them is one line at the single
 * place a deployment already names its providers:
 *
 * ```ts
 * const providers = defineProviders({
 *   stripe: stripeProvider(PT_BR_STRIPE_COPY),
 *   stone: stoneProvider(PT_BR_STONE_COPY),
 * } as const);
 * ```
 *
 * Nothing here is defaulted. A default would be one product's Portuguese
 * compiled into every other product's settings screen, which is the failure
 * this whole port exists to end — and a package that ships a fallback never
 * finds out a host forgot to translate it.
 *
 * ## Credential labels travel too, and the reason is the interesting part
 *
 * Stripe's four fields are not in here: its form says `Secret key (sk_...)`,
 * which is the label printed on Stripe's own dashboard, and "translating" it
 * would send an owner hunting for a box that does not exist under that name.
 * Stone, PagBank and InfinitePay label the same kind of field in Portuguese —
 * `Chave secreta (sk_...)`, `Token do PagBank` — and those are OUR words for a
 * vendor's field, so they move.
 *
 * The test is whose sentence it is, not whether it is Portuguese. `sk_...` and
 * `$usuario` stay put inside the label a host writes, because they are the
 * shapes an owner is matching against on the other screen.
 */

/** The one sentence every credential probe shares: nothing answered. */
export interface ProbeUnreachableCopy {
  /**
   * No answer arrived, so nothing the owner typed is in question.
   *
   * A plain string per provider rather than one shared sentence taking a name:
   * Portuguese agrees the article with the vendor ("a Stripe", "o PagBank"),
   * and picking the article is the translator's job, not a `${}` slot's.
   */
  unreachable: string;
}

/** Stone/Pagar.me — the credential form, its probe, and the boleto it prints. */
export interface StoneCopy extends ProbeUnreachableCopy {
  /** Nothing to authenticate with — the probe never leaves the process. */
  secretKeyMissing: string;
  /** Stone answered 401/403: the key itself is refused. */
  refused: string;
  /**
   * The credential form's labels.
   *
   * Every field, not only the ones a diacritic gate can see: `Usuário do
   * webhook` and `Senha do webhook` are as Portuguese as `Chave pública`, and
   * a port that moved three of four would read as done while the form still
   * spoke one language.
   */
  fields: {
    secretKey: string;
    publicKey: string;
    webhookUser: string;
    webhookPassword: string;
  };
  /**
   * The two strings in here a BUYER reads rather than the store owner. They
   * travel to Stone in the charge payload rather than to a screen, and they
   * are printed by somebody else — which is exactly why they must be the
   * host's: nobody can edit them after the fact.
   */
  payer: {
    /** The instruction line on the boleto. */
    boletoInstructions: string;
    /**
     * What the charge is called on the buyer's card statement.
     *
     * Unaccented, so no diacritic scan would ever have found it — and it is a
     * word from ONE product's vocabulary appearing on a stranger's customers'
     * bank statements.
     */
    statementDescriptor: string;
  };
}

/** PagBank — the credential form and its probe. */
export interface PagbankCopy extends ProbeUnreachableCopy {
  /** No token stored, so the probe has nothing to send. */
  tokenMissing: string;
  /** PagBank answered 401/403. */
  refused: string;
  /** The credential form's labels — all four, see {@link StoneCopy.fields}. */
  fields: {
    token: string;
    publicKey: string;
    webhookToken: string;
    googlePayMerchantId: string;
  };
}

/** InfinitePay — the tag that decides where the money lands. */
export interface InfinitePayCopy extends ProbeUnreachableCopy {
  /** No handle stored yet. */
  handleMissing: string;
  /**
   * The tag resolved to nobody (404).
   *
   * Says where to look, because that is the whole value of the sentence: the
   * InfiniteTag decides which account is paid, and "confira as credenciais"
   * is advice an owner can follow all afternoon without finding the one screen
   * in the app that states it.
   */
  tagNotFound: string;
  /** InfinitePay answered 401/403. */
  refused: string;
  /** The charge was accepted and came back with no hosted checkout URL. */
  noCheckoutUrl: string;
  /** The line under the tag input — how to check the value, not what it is for. */
  handleHelp: string;
  /** The tag field's own label. */
  fields: { handle: string };
}

/**
 * Which Stripe key mode a sentence is talking about.
 *
 * Passed as the FACT rather than as a rendered word: "live" appears mid-sentence
 * in four different verdicts below, and handing the adapter's spelling of it
 * across the boundary would leave the host writing sentences around a fragment
 * it did not choose.
 */
export interface StripeModeFacts {
  /** The mode the key states about itself, from its own prefix. */
  key: boolean;
  /** The mode this connection is configured for. */
  connection: boolean;
}

/**
 * Stripe's per-credential probe verdicts (FUT-796).
 *
 * Every entry takes the facts the check established and nothing pre-composed.
 * `viaGrant` in particular: an authorization and a pasted secret key are the
 * same credential to Stripe and two different nouns to an owner, and which
 * noun leads the sentence changes its whole shape.
 */
export interface StripeCredentialCopy {
  /** Authenticated, but Stripe has not released charging on the account. */
  chargesDisabled(viaGrant: boolean, accountId: string | null): string;
  /** The charging key is for the other mode. */
  secretKeyModeMismatch(viaGrant: boolean, mode: StripeModeFacts): string;
  /** Accepted, and the account it answers for is known. */
  secretKeyResolved(viaGrant: boolean, accountId: string): string;
  /** Accepted, with no account id in the answer. */
  secretKeyAccepted(viaGrant: boolean): string;
  /** No publishable key: the browser cannot tokenize a card. */
  publishableKeyMissing: string;
  /** Present, but not shaped like a publishable key. */
  publishableKeyShape: string;
  /** Present and well-shaped, but from the other mode. */
  publishableKeyModeMismatch(mode: StripeModeFacts): string;
  /** Present, well-shaped and in the connection's own mode. */
  publishableKeyOk(live: boolean): string;
  /** Connected by grant: deliveries land on the platform's endpoint. */
  webhookSecretViaGrant: string;
  /** No signing secret, and no grant to excuse it. */
  webhookSecretMissing: string;
  /** Present, but not shaped like a signing secret. */
  webhookSecretShape: string;
  /**
   * Well-shaped, and that is ALL that can be established.
   *
   * The verdict this port must not let a host soften into a pass: Stripe
   * publishes no way to ask whether a signing secret is the right one.
   */
  webhookSecretShapeOnly: string;
  /** The declared connected account is not the one the key answers for. */
  connectedAccountMismatch(resolved: string, declared: string): string;
  /** The declared connected account agrees with the key. */
  connectedAccountOk(declared: string): string;
  /**
   * The lead sentence when more than one credential failed.
   *
   * A function over the count and the first failure's own sentence, because
   * where the number goes — and whether the language needs it at all — is not
   * this package's call.
   */
  severalFailed(count: number, firstMessage: string): string;
}

/** Stripe — the credential form, the probe, and its per-credential verdicts. */
export interface StripeCopy extends ProbeUnreachableCopy {
  checks: StripeCredentialCopy;
  /**
   * Stripe answered 401/403, with its own explanation when it sent one.
   *
   * Unaccented Portuguese, which is why no diacritic scan ever saw it. The
   * `detail` is Stripe's English sentence naming the box to fix ("Invalid API
   * Key provided: sk_test_***…***4242"); it is passed through rather than
   * translated, because it is the provider talking.
   */
  refused(detail: string | null): string;
  fields: {
    /**
     * The advisory under `connectedAccountId` — an EXTRA nearly every store
     * must leave empty, and the field owners filled with their own account id
     * until it said so (which makes Stripe refuse every call).
     */
    connectedAccountHelp: string;
  };
}

/**
 * The words each shipped adapter needs, keyed exactly as the catalog is
 * (FUT-760).
 *
 * A host names all four in one place. It is also what keeps `providerCatalog`
 * honest: adding an adapter there without a pack here fails typecheck at its
 * `satisfies` — the same trick that stops a hand-kept list from silently
 * skipping the newest adapter.
 */
export interface ProviderCopyPacks {
  pagbank: PagbankCopy;
  stone: StoneCopy;
  infinitepay: InfinitePayCopy;
  stripe: StripeCopy;
}
