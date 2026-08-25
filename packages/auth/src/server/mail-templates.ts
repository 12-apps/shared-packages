import type { AuthEmailMessage } from "../email-credentials/types";
import { resolveEmailAuthCopy, type EmailAuthCopySource } from "./messages";

/**
 * The four auth e-mails: one layout, and a pack of words per language.
 *
 * ## Why the layout is here and the words are not
 *
 * The HTML skeleton, the plain-text twin, the escaping and the "if the button
 * does not work, paste this" fallback are MECHANISM — they are identical in
 * every deployment and every language, and getting them wrong (an unescaped
 * display name, a missing text half) is a security or deliverability bug rather
 * than a style choice. The sentences are product voice, and belong to whoever
 * ships the product.
 *
 * So a host picks a pack, or writes one. Both languages ship — `PT_BR_MAIL`
 * from `./mail-templates.pt-BR`, `EN_US_MAIL` from `./mail-templates.en-US`,
 * paired as `AUTH_MAIL` in `../locales` — and a host with one audience still
 * passes one of them by name.
 *
 * ## Which language a given message is written in
 *
 * The pack field is a {@link EmailAuthCopySource}, so a host may hand a
 * RESOLVER instead of a pack and let each message follow its recipient.
 * {@link renderAuthMail} resolves it here, per message, from
 * {@link AuthEmailMessage.locale} — never once at the mount, which would
 * re-freeze the language into the deployment and look identical to a host that
 * only speaks one.
 */

/** Escape anything that reaches the HTML body — a display name is user input. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The words for one message, given what the flow knows about it. */
export interface MailCopy {
  subject: string;
  /** "Olá, Ana" / "Hi Ana" — the name may be absent. */
  greeting: (name: string | null | undefined) => string;
  lead: (context: { validFor: string }) => string;
  cta: string;
  footer: string;
}

/** One pack per language: the four messages, plus the shared chrome. */
export interface MailPack {
  verification: MailCopy;
  passwordReset: MailCopy;
  alreadyRegistered: MailCopy;
  passwordChanged: MailCopy;
  /** "If the button does not work, paste this address into your browser:" */
  fallbackHint: string;
  /** How a lifetime is written — "1 hora", "24 horas", "2 dias". */
  validFor: (hours: number) => string;
}


/** How long a link lasts, in the words a person uses for it. */
function hoursUntil(expiresAt: Date | undefined, now: number): number {
  if (!expiresAt) return 1;
  return Math.max(1, Math.round((expiresAt.getTime() - now) / 3_600_000));
}

/** One layout for all four, so the messages look like they came from one product. */
function html(pack: MailPack, body: { greeting: string; lead: string; cta: string; link: string; footer: string }): string {
  // Inline styles only: every mail client strips a `<style>` block.
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:520px;margin:0 auto;padding:24px">
  <p>${escapeHtml(body.greeting)},</p>
  <p>${escapeHtml(body.lead)}</p>
  <p style="margin:28px 0">
    <a href="${body.link}" style="background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(body.cta)}</a>
  </p>
  <p style="font-size:13px;color:#666">${escapeHtml(pack.fallbackHint)}<br><span style="word-break:break-all">${body.link}</span></p>
  <p style="font-size:13px;color:#666">${escapeHtml(body.footer)}</p>
</div>`;
}

/** The plain-text twin. Some clients show only this, and some people prefer it. */
function text(body: { greeting: string; lead: string; link: string; footer: string }): string {
  return `${body.greeting},\n\n${body.lead}\n\n${body.link}\n\n${body.footer}\n`;
}

/** A rendered message, ready for whatever vendor the host sends through. */
export interface RenderedMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Render one of the four, from a pack and what the flow knows.
 *
 * The pack is resolved HERE rather than by the caller, because this is the
 * moment the recipient is known: `message.locale` is their stored language,
 * carried by the flow off their own row. A caller that resolved first and
 * passed a value would have had to pick a language before it knew whose
 * message this was.
 */
export function renderAuthMail(
  source: EmailAuthCopySource<MailPack>,
  kind: "verification" | "passwordReset" | "alreadyRegistered" | "passwordChanged",
  message: AuthEmailMessage,
  now: number = Date.now(),
): RenderedMail {
  const pack = resolveEmailAuthCopy(source, message.locale ?? undefined);
  const copy = pack[kind];
  const validFor = pack.validFor(hoursUntil(message.expiresAt, now));
  const parts = {
    greeting: copy.greeting(message.name),
    lead: copy.lead({ validFor }),
    cta: copy.cta,
    link: message.link,
    footer: copy.footer,
  };
  return {
    to: message.to,
    subject: copy.subject,
    text: text(parts),
    html: html(pack, parts),
  };
}
