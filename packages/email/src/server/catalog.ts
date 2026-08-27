import type { RenderedEmail } from '../template';

/**
 * The preview catalogue: every message a host can send, as a navigable set.
 *
 * ## The problem it exists for
 *
 * There is normally no way to SEE a transactional mail without triggering the
 * event that sends it — signing up with a throwaway address to look at the
 * verification mail, settling an order to look at the receipt, exhausting a
 * quota to look at that alert. So nobody looks, and a host that renders mail in
 * three different ways does not find out.
 *
 * A layout nobody can see is one release from being three layouts again, which
 * is why this ships in the same package as the layout rather than beside it.
 *
 * ## What is the package's and what is the host's
 *
 * The MECHANISM is here: group by owner, render one message for one reader,
 * report what cannot be shown. WHICH messages exist is the host's, and it
 * cannot be otherwise — a package cannot know that a host sends a
 * "your quota is exhausted" notice, let alone what data that notice is
 * rendered from.
 *
 * So a host declares SOURCES. Each names an owner and answers with its
 * messages, and the catalogue is the union. That inverts the obvious design,
 * where the package would hold a registry a host writes into: a source is
 * asked, per request, so a source backed by a registry that fills at import
 * time answers with whatever is registered NOW rather than with whatever had
 * been registered when the mount was built.
 *
 * ## Why coverage is a first-class output
 *
 * A catalogue that quietly omits a message looks exactly like a product that
 * does not send it. So a source may report what it knows it cannot show —
 * a message with no sample data, or sample data for a message that no longer
 * exists — and the surface returns that beside the list rather than swallowing
 * it. A gap that is visible is a gap somebody closes.
 */

/** One previewable message. */
export interface EmailPreviewMessage {
  /**
   * Stable id, and the path segment the console navigates by.
   *
   * The host chooses the spelling; the surface only requires it to be unique
   * across every source. Ids that survive a rename are what make a link to one
   * mail worth sending to a colleague.
   */
  readonly id: string;
  /** The wire identity — an event type, a template key. Shown beside the subject. */
  readonly key: string;
  /** Which mail path this belongs to, for grouping inside one owner. */
  readonly family: string;
  /** Render it for one reader. MUST be pure — nothing may be sent. */
  render(locale: string): RenderedEmail;
}

/** What a source knows it cannot show. Both directions are worth reporting. */
export interface EmailPreviewCoverage {
  /** Messages that exist but have no sample data, so no preview. */
  readonly missing: readonly string[];
  /** Sample data for a message nothing produces any more. */
  readonly orphan: readonly string[];
}

/** One group of messages, owned by whichever code words them. */
export interface EmailPreviewSource {
  /**
   * Who owns these messages — a package name, or the host's own module.
   *
   * This is the console's grouping, and it is the answer to "which parts of
   * this system send mail", which is a question most hosts cannot otherwise
   * answer at all.
   */
  readonly owner: string;
  /** Called PER REQUEST — see the docblock above for why that matters. */
  list(): readonly EmailPreviewMessage[];
  /** Optional: what this source cannot show. Absent means "nothing missing". */
  coverage?(): EmailPreviewCoverage;
}

/** One catalogue row: everything the sidebar needs, and no rendered bytes. */
export interface EmailPreviewRow {
  readonly id: string;
  readonly key: string;
  readonly family: string;
  readonly owner: string;
  /** The subject in the requested language, so the list reads as an inbox. */
  readonly subject: string;
}

/** One rendered message: what the vendor would be handed, verbatim. */
export interface EmailPreviewDetail extends EmailPreviewRow {
  readonly locale: string;
  readonly html: string;
  readonly text: string;
}

export interface EmailPreviewIndex {
  readonly locale: string;
  readonly locales: readonly string[];
  readonly items: readonly EmailPreviewRow[];
  readonly coverage: EmailPreviewCoverage;
}

export interface EmailPreviewsConfig {
  /** The host's sources, in the order the console should list their owners. */
  readonly sources: readonly EmailPreviewSource[];
  /**
   * The languages a preview may be asked for.
   *
   * REQUIRED, and not derived from the shipped packs: a host's own messages may
   * be written in languages this package has never heard of, and a preview that
   * silently refused one of them would look exactly like a product with no
   * translation.
   */
  readonly locales: readonly string[];
  /** The language a preview opens in when the caller names none. */
  readonly defaultLocale: string;
}

/** An id that appears in more than one source — the one thing that must not happen. */
export class DuplicateEmailPreviewIdError extends Error {
  constructor(id: string) {
    super(`@12-apps/email: two preview messages share the id "${id}".`);
    this.name = 'DuplicateEmailPreviewIdError';
    Object.setPrototypeOf(this, DuplicateEmailPreviewIdError.prototype);
  }
}

/** The catalogue, assembled from every source. */
export interface ApiEmailPreviews {
  /** Every message, with each subject rendered in `locale`. */
  index(locale?: string): EmailPreviewIndex;
  /** One rendered message, or `null` when no source owns that id. */
  render(id: string, locale?: string): EmailPreviewDetail | null;
  /** The union of every source's gaps. */
  coverage(): EmailPreviewCoverage;
  /** Is this a language the host said it writes in? */
  supportsLocale(locale: string): boolean;
}

/** One source's messages, tagged with their owner. */
interface OwnedMessage {
  readonly owner: string;
  readonly message: EmailPreviewMessage;
}

function collect(sources: readonly EmailPreviewSource[]): OwnedMessage[] {
  const owned = sources.flatMap((source) =>
    source.list().map((message) => ({ owner: source.owner, message })),
  );
  const seen = new Set<string>();
  for (const { message } of owned) {
    // A duplicate id makes one message unreachable and the other ambiguous —
    // and silently, since the console would simply show whichever came first.
    // Throwing here surfaces it on the request that would have hidden it.
    if (seen.has(message.id)) throw new DuplicateEmailPreviewIdError(message.id);
    seen.add(message.id);
  }
  return owned;
}

export function createEmailPreviews(config: EmailPreviewsConfig): ApiEmailPreviews {
  const { sources, locales, defaultLocale } = config;
  const localeOf = (locale?: string): string =>
    locale && locales.includes(locale) ? locale : defaultLocale;

  const rowOf = ({ owner, message }: OwnedMessage, locale: string): EmailPreviewRow => ({
    id: message.id,
    key: message.key,
    family: message.family,
    owner,
    subject: message.render(locale).subject,
  });

  return {
    index(locale) {
      const tag = localeOf(locale);
      return {
        locale: tag,
        locales,
        items: collect(sources).map((owned) => rowOf(owned, tag)),
        coverage: this.coverage(),
      };
    },
    render(id, locale) {
      const owned = collect(sources).find((entry) => entry.message.id === id);
      if (!owned) return null;
      const tag = localeOf(locale);
      const message = owned.message.render(tag);
      return { ...rowOf(owned, tag), locale: tag, html: message.html, text: message.text };
    },
    coverage() {
      const missing: string[] = [];
      const orphan: string[] = [];
      for (const source of sources) {
        const gap = source.coverage?.();
        if (!gap) continue;
        missing.push(...gap.missing);
        orphan.push(...gap.orphan);
      }
      return { missing: missing.sort(), orphan: orphan.sort() };
    },
    supportsLocale: (locale) => locales.includes(locale),
  };
}
