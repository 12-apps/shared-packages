/**
 * The SHAPE of the operator screen's words — no words.
 *
 * REQUIRED config with no default in any language, the copy-portability
 * doctrine. `./copy.pt-BR` and `./copy.en-US` ship packs a host passes BY NAME.
 *
 * What is NOT here is anything from the mails themselves: a subject, a body and
 * a button label all arrive from the server already rendered in whichever
 * language the preview was asked for. That separation is the point of the
 * language switch — the CHROME follows the operator, the MESSAGE follows its
 * own recipient.
 */
export interface EmailPreviewScreenCopy {
  readonly title: string;
  readonly description: string;
  /** The sidebar's filter field. */
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  /** Nothing matched the filter. */
  readonly noMatches: string;
  /** No row is selected yet. */
  readonly pickOne: string;
  /** The three views of one message. */
  readonly tabHtml: string;
  readonly tabText: string;
  readonly tabSource: string;
  /** The two widths the HTML view renders at. */
  readonly widthDesktop: string;
  readonly widthMobile: string;
  /** The subject line's label above the preview. */
  readonly subjectLabel: string;
  /** The sandboxed frame's title, for screen readers. */
  readonly frameTitle: string;
  /** The coverage strip, when the surface reports a gap. */
  readonly coverageTitle: string;
  readonly missingSamples: (keys: string) => string;
  readonly orphanSamples: (keys: string) => string;
  /** Loading and failure states. */
  readonly loading: string;
  readonly loadError: string;
  readonly retry: string;
}
