/**
 * Every word the PLATFORM's homologação screens render.
 *
 * The reader here is not a buyer and not a merchant: it is whoever operates
 * the platform, submitting a vendor homologação on behalf of every tenant on
 * it. That made this surface look internal enough to write literals into for a
 * long time, and it is not — a second platform adopting
 * `@12-apps/payments-frontend` mounts these same four cards, and its operator
 * reads whatever this package decided, in whatever language it decided.
 *
 * So the same rule as every other surface here: REQUIRED, no defaults. A pack
 * for one language ships as `PT_BR_PLATFORM_HOMOLOGACAO_COPY` and a host
 * passes it by hand.
 *
 * What is NOT here, deliberately: `HomologacaoGuide.fieldLabels` and the guide's
 * three URLs. Those are PagBank's own form field names and pages, answered by
 * the backend adapter, and a translation of them produces a submission their
 * form does not accept.
 */

/** The outcome card: what was submitted, and what came back. */
export interface HomologacaoOutcomeCopy {
  heading: string;
  /** The status a record carries — and what "no record at all" reads as. */
  statusLabel: string;
  notSubmitted: string;
  /** The two free-text fields, each with a visible-less input. */
  protocolLabel: string;
  protocolPlaceholder: string;
  notesLabel: string;
  notesPlaceholder: string;
  /** Save, and the confirmation after it. */
  save: string;
  saved: string;
  /** The three statuses a record can carry, keyed by the stored value. */
  statuses: Readonly<Record<string, string>>;
  /**
   * The trail under the heading, one clause per timestamp the record has. Each
   * takes its own value because the ORDER of word and date differs by language
   * and this line concatenates whichever clauses exist.
   */
  submittedAt(when: string): string;
  decidedAt(when: string): string;
  recordedBy(who: string): string;
}

/** The paste-ready answers card, and the three links woven through its lede. */
export interface HomologacaoGuideCopy {
  heading: string;
  /**
   * The instruction paragraph, in the runs it renders as: text, link, text,
   * link, text, link, text. Split because two of the links sit MID-SENTENCE,
   * so a single string with placeholders could not carry them.
   */
  ledeBeforeForm: string;
  formLink: string;
  ledeBeforeSupport: string;
  supportLink: string;
  ledeBeforeDocs: string;
  docsLink: string;
  ledeAfterDocs: string;
}

/** The evidence-file card. */
export interface HomologacaoAnexoCopy {
  heading: string;
  body: string;
  generate: string;
  /** A generate that threw something carrying no message of its own. */
  generateFailed: string;
}

/** The Connect application panel, and the environment card under it. */
export interface ConnectApplicationCopy {
  /** The callback the deployment uses — the value that must be registered. */
  expectedRedirectHeading: string;
  consultAgain: string;
  /** No application resolved for this environment at all. */
  noApplication: string;
  /**
   * The three verdicts on the registered `redirect_uri`: it matches, it does
   * not, or PagBank reported none to compare against. A mismatch is the whole
   * reason this card exists, so all three read as findings rather than states.
   */
  redirectMatches: string;
  redirectDiffers: string;
  redirectUnreported: string;
  /** The application's own fields, as PagBank reports them. */
  fields: {
    name: string;
    site: string;
    description: string;
    logo: string;
    redirectUri: string;
  };
  /** What a field with no value reads as, and an unreported redirect_uri. */
  fieldEmpty: string;
  redirectNotReported: string;
  /** Where the environment's application comes from, and its disclosure. */
  resolvedFrom: string;
  showConfig: string;
  hideConfig: string;
  /** The heading above whatever extra keys PagBank's response carried. */
  extraKeys: string;
}

/** The whole platform surface, in one object a host passes at the mount. */
export interface PlatformHomologacaoCopy {
  outcome: HomologacaoOutcomeCopy;
  guide: HomologacaoGuideCopy;
  anexo: HomologacaoAnexoCopy;
  connect: ConnectApplicationCopy;
}
