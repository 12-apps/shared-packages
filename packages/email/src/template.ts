import { renderEmailText } from './text';
import {
  EMAIL_CONTENT_WIDTH,
  EMAIL_FONT_STACK,
  NEUTRAL_EMAIL_THEME,
  type EmailTheme,
} from './theme';

/**
 * THE transactional-mail layout: one document model, one HTML renderer, one
 * plain-text twin.
 *
 * ## The problem it exists for
 *
 * A host that sends mail from more than one place ends up rendering it in more
 * than one way — the notification pipeline emits a bold paragraph and a bare
 * anchor, the sign-in flow emits a `div` with a max-width, the receipt builds
 * its own list — and each grows its own `escapeHtml` and its own text twin. The
 * three look like three different products, because a paragraph with no
 * document around it inherits whatever the client decides: 13px Arial in Gmail,
 * Times New Roman in Outlook, no centring anywhere.
 *
 * That is a LAYOUT problem rather than a wording one, which is what makes it a
 * package's to solve. The words stay the host's; the document does not.
 *
 * ## Why the document is a MODEL and not a string
 *
 * Every caller hands over structure — a heading, some paragraphs, an optional
 * facts table, at most one call to action — and never markup. Three things fall
 * out of that, and each is a real defect in the hand-rolled renderers this
 * replaces:
 *
 * 1. **Escaping cannot be forgotten.** Every field is escaped here, once. Of
 *    the three renderers this was extracted from, two escaped the body and
 *    interpolated the LINK raw.
 * 2. **The plain-text twin cannot drift.** Both halves render from the same
 *    object, so a line added to one is in the other. A `text/html` part with no
 *    `text/plain` twin is scored by every major spam filter, and it is what a
 *    watch, a terminal client and a screen reader in plain-text mode show.
 * 3. **A preview is honest.** `./server`'s catalogue renders exactly this, from
 *    exactly these inputs, so a preview cannot be right about a mail nobody
 *    gets.
 *
 * ## The client constraints this encodes
 *
 * Stated once here, so no caller has to know them:
 *
 * - **Tables, not divs.** Outlook 2016+ on Windows lays HTML out with Word,
 *   which supports no `flex`, no `grid` and no reliable `max-width` on a block.
 *   A centred 600px table is the one construction every client agrees on.
 * - **Inline styles.** Gmail strips `<style>` from the document it renders in
 *   several contexts, and always in the Gmail app for a non-Gmail account. The
 *   `<style>` block below therefore carries only the mobile media query —
 *   progressive enhancement, never anything the layout depends on.
 * - **No web fonts, no `color-mix()`, no CSS variables.** See `./theme`.
 * - **A preheader.** The inbox list shows the first text in the body after the
 *   subject; without one it shows the footer's legal line.
 * - **`role="presentation"`** on every layout table, so a screen reader reads
 *   the message rather than announcing a five-column grid.
 */

/** The words the LAYOUT itself needs — never the message's own sentences. */
export interface EmailChromeCopy {
  /** "If the button does not work, paste this address into your browser:" */
  readonly fallbackHint: string;
  /** "This is an automated message — please do not reply." */
  readonly automated: string;
  /** The footer's one line about the product, given the brand name. */
  readonly tagline: (brand: string) => string;
}

/** The one call to action a message may carry. More than one dilutes both. */
export interface EmailAction {
  readonly label: string;
  readonly href: string;
}

/** One row of the facts panel — a receipt's total, an order's reference. */
export interface EmailFact {
  readonly label: string;
  readonly value: string;
  /** Renders bolder and larger — the one number the reader came for. */
  readonly emphasis?: boolean;
}

/** Everything a message says, with no opinion about how it looks. */
export interface EmailDocument {
  /** The subject line. Also the document `<title>`. */
  readonly subject: string;
  /**
   * The inbox-list preview, ~90 chars. Falls back to the first paragraph,
   * which is right far more often than it is wrong.
   */
  readonly preheader?: string;
  /** The `<h1>`. Usually a restatement of the subject in the reader's terms. */
  readonly heading: string;
  /** The body, one entry per paragraph. Plain sentences — never markup. */
  readonly paragraphs?: readonly string[];
  /** An optional label/value panel under the body. */
  readonly facts?: readonly EmailFact[];
  /** At most one CTA. */
  readonly action?: EmailAction;
  /** Small print under the CTA — a deadline, a "you can ignore this". */
  readonly notes?: readonly string[];
  /**
   * The layout's own words, in the recipient's language.
   *
   * REQUIRED, with no default in any language — the copy-portability doctrine.
   * `@12-apps/email/locales` ships a pack per language and a host passes one BY
   * NAME, which is a decision rather than a silence.
   */
  readonly chrome: EmailChromeCopy;
  /**
   * The product name in the header and the footer. REQUIRED: a package that
   * defaulted this would sign another company's mail.
   */
  readonly brand: string;
  /** The recipient's language, for the document's `lang` attribute. */
  readonly locale: string;
  /** Defaults to {@link NEUTRAL_EMAIL_THEME} — see `./theme` for why this one may. */
  readonly theme?: EmailTheme;
}

/**
 * Escape everything that reaches the HTML body.
 *
 * A store name, a buyer's display name and a product title are all user input
 * that reaches a mail, and the ONE thing a shared layout must guarantee is that
 * none of them can close a tag. Single quotes are escaped too: attribute values
 * below are double-quoted, but a caller reading this should not have to check.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The schemes a link in a mail may use.
 *
 * `javascript:` is inert in every mail client, so this is not the XSS guard it
 * would be on a page — it is the guard for the PREVIEW, which renders the same
 * HTML in a browser, and for the day some part of this markup is reused on a
 * screen. A rejected href drops to `#`, which fails visibly rather than
 * silently linking somewhere unexpected.
 */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** A URL as an attribute value, or `#` when it is not one this layout will emit. */
export function safeHref(href: string): string {
  const trimmed = href.trim();
  // A relative link is fine and common — every caller that has an origin
  // resolves it before it gets here, and one that does not is better off with
  // a path than with nothing.
  if (trimmed.startsWith("/")) return escapeHtml(trimmed);
  try {
    const url = new URL(trimmed);
    return SAFE_LINK_SCHEMES.has(url.protocol) ? escapeHtml(url.toString()) : "#";
  } catch {
    return "#";
  }
}

/** The message's own first sentence, when the caller named no preheader. */
function preheaderOf(document: EmailDocument): string {
  return document.preheader ?? document.paragraphs?.[0] ?? document.heading;
}

/** A `<td>` of body copy. One paragraph, at the layout's own rhythm. */
function paragraph(text: string, theme: EmailTheme): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${theme.ink}">${escapeHtml(text)}</p>`;
}

/**
 * The facts panel — a receipt's four lines, an order's reference.
 *
 * Two cells per row rather than a definition list: `<dl>` is styled
 * inconsistently across clients and collapses to a single column in Outlook,
 * which is the one place these are read side by side.
 */
function facts(rows: readonly EmailFact[], theme: EmailTheme): string {
  if (rows.length === 0) return "";
  const cells = rows
    .map((row, index) => {
      const divider =
        index === 0 ? "" : `border-top:1px solid ${theme.border};`;
      const value = row.emphasis
        ? `font-size:20px;font-weight:700;color:${theme.ink}`
        : `font-size:15px;color:${theme.ink}`;
      return [
        `<tr>`,
        `<td style="${divider}padding:12px 0 12px 16px;font-size:13px;line-height:1.4;color:${theme.muted};text-transform:uppercase;letter-spacing:.4px;white-space:nowrap">${escapeHtml(row.label)}</td>`,
        `<td align="right" style="${divider}padding:12px 16px 12px 0;line-height:1.4;${value}">${escapeHtml(row.value)}</td>`,
        `</tr>`,
      ].join("");
    })
    .join("");
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;background:${theme.page};border:1px solid ${theme.border};border-radius:10px;margin:0 0 24px">`,
    cells,
    `</table>`,
  ].join("");
}

/**
 * The CTA.
 *
 * A single-cell table with `bgcolor` AND a background style: Outlook reads the
 * attribute and ignores the property, every other client does the reverse, and
 * a button that loses its fill is invisible ink on white. `border-radius` is
 * simply dropped by Word — a square button is the accepted degradation, and the
 * alternative (a VML rounded rectangle) is forty lines of conditional comment
 * that then has to be kept in step with the colour.
 */
function action(cta: EmailAction, theme: EmailTheme): string {
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">`,
    `<tr>`,
    `<td align="center" bgcolor="${theme.accent}" style="border-radius:8px;background:${theme.accent}">`,
    `<a href="${safeHref(cta.href)}" style="display:inline-block;padding:14px 32px;font-family:${EMAIL_FONT_STACK};font-size:16px;font-weight:600;line-height:1;color:${theme.onAccent};text-decoration:none;border-radius:8px">${escapeHtml(cta.label)}</a>`,
    `</td>`,
    `</tr>`,
    `</table>`,
  ].join("");
}

/**
 * The "paste this address" fallback, printed whenever there is a CTA.
 *
 * Not optional, and the reason is measured elsewhere in this repo: corporate
 * mail gateways rewrite link targets, and a reader whose gateway mangles the
 * button has no other way to reach a verification or reset link. `word-break`
 * because a signed URL is longer than the card.
 */
function fallback(cta: EmailAction, chrome: EmailChromeCopy, theme: EmailTheme): string {
  return [
    `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${theme.muted}">${escapeHtml(chrome.fallbackHint)}</p>`,
    `<p style="margin:0 0 24px;font-size:13px;line-height:1.5;word-break:break-all"><a href="${safeHref(cta.href)}" style="color:${theme.accent};text-decoration:underline">${escapeHtml(cta.href)}</a></p>`,
  ].join("");
}

/** The brand header: wordmark over the ramp's rule. */
function header(document: EmailDocument, theme: EmailTheme): string {
  return [
    `<tr>`,
    `<td style="padding:32px 40px 0">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    `<tr><td style="font-size:20px;font-weight:700;letter-spacing:-.2px;color:${theme.ink}">${escapeHtml(document.brand)}</td></tr>`,
    `<tr><td style="padding-top:12px"><div style="height:3px;width:44px;background:${theme.rule};border-radius:2px;font-size:0;line-height:0">&nbsp;</div></td></tr>`,
    `</table>`,
    `</td>`,
    `</tr>`,
  ].join("");
}

/** The footer: the tagline, the "do not reply" line, and nothing else. */
function footer(document: EmailDocument, theme: EmailTheme): string {
  const { chrome, brand } = document;
  return [
    `<tr>`,
    `<td style="padding:0 40px 40px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    `<tr><td style="border-top:1px solid ${theme.border};padding-top:20px">`,
    `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${theme.muted}">${escapeHtml(chrome.tagline(brand))}</p>`,
    `<p style="margin:0;font-size:12px;line-height:1.5;color:${theme.muted}">${escapeHtml(chrome.automated)}</p>`,
    `</td></tr>`,
    `</table>`,
    `</td>`,
    `</tr>`,
  ].join("");
}

/**
 * The mobile media query — the one thing in a `<style>` block.
 *
 * Everything it does is also correct without it: the card is already
 * `width:100%` up to 600px, so a client that strips this renders a slightly
 * roomier mail rather than a broken one. That is the test for whether a rule
 * belongs here at all.
 */
function styleBlock(): string {
  return [
    `<style>`,
    `@media only screen and (max-width:620px){`,
    `.fp-card{width:100%!important;border-radius:0!important;border-left:0!important;border-right:0!important}`,
    `.fp-pad{padding-left:24px!important;padding-right:24px!important}`,
    `.fp-h1{font-size:22px!important}`,
    `}`,
    `</style>`,
  ].join("");
}

/**
 * Render the document as the HTML half of the message.
 *
 * A complete document rather than a fragment: a `<!DOCTYPE>` is what puts
 * Outlook into standards mode, and `x-apple-disable-message-reformatting` is
 * what stops iOS Mail re-flowing the card to the screen width and shrinking the
 * type with it.
 */
export function renderEmailHtml(document: EmailDocument): string {
  const theme = document.theme ?? NEUTRAL_EMAIL_THEME;
  const body = [
    `<h1 class="fp-h1" style="margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-.3px;color:${theme.ink}">${escapeHtml(document.heading)}</h1>`,
    ...(document.paragraphs ?? []).map((text) => paragraph(text, theme)),
    facts(document.facts ?? [], theme),
    ...(document.action ? [action(document.action, theme)] : []),
    ...(document.action ? [fallback(document.action, document.chrome, theme)] : []),
    ...(document.notes ?? []).map(
      (note) =>
        `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${theme.muted}">${escapeHtml(note)}</p>`,
    ),
  ].join("\n      ");

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeHtml(document.locale)}">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(document.subject)}</title>
${styleBlock()}
</head>
<body style="margin:0;padding:0;background:${theme.page};font-family:${EMAIL_FONT_STACK};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheaderOf(document))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.page}">
<tr>
<td align="center" style="padding:32px 12px">
<table role="presentation" class="fp-card" width="${EMAIL_CONTENT_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:${EMAIL_CONTENT_WIDTH}px;max-width:100%;background:${theme.surface};border:1px solid ${theme.border};border-radius:14px">
${header(document, theme)}
<tr>
<td class="fp-pad" style="padding:24px 40px 8px">
      ${body}
</td>
</tr>
${footer(document, theme)}
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

/** Both halves plus the subject — what every driver in this repo is handed. */
export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** Render one document into the message shape `EmailDriver.send` takes. */
export function renderEmail(document: EmailDocument): RenderedEmail {
  return {
    subject: document.subject,
    html: renderEmailHtml(document),
    text: renderEmailText(document),
  };
}
