import type { AuthEmailMessage } from "../email-credentials/types";

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
 * So a host picks a pack, or writes one. `PT_BR_MAIL` is the only pack bundled
 * today: one is enough to make the seam real, and a translation nobody has read
 * is worse than an obvious gap. Adding `EN_MAIL` later is a new object in this
 * file and no change to any host that did not ask for it.
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

/** Brazilian Portuguese. The first pack, and today the only one. */
export const PT_BR_MAIL: MailPack = {
  fallbackHint: "Se o botão não funcionar, copie e cole este endereço no navegador:",
  validFor: (hours) => {
    if (hours >= 24) {
      const days = Math.round(hours / 24);
      return days === 1 ? "24 horas" : `${days} dias`;
    }
    return hours === 1 ? "1 hora" : `${hours} horas`;
  },
  verification: {
    subject: "Confirme seu e-mail",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    lead: ({ validFor }) =>
      `Confirme seu e-mail para ativar sua conta. O link vale por ${validFor} e só pode ser usado uma vez.`,
    cta: "Confirmar meu e-mail",
    footer: "Se não foi você, pode ignorar esta mensagem com segurança.",
  },
  passwordReset: {
    subject: "Redefinir sua senha",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    lead: ({ validFor }) =>
      `Você pediu para redefinir sua senha. O link vale por ${validFor} e só pode ser usado uma vez.`,
    cta: "Criar uma nova senha",
    footer:
      "Se não foi você, pode ignorar esta mensagem com segurança. Sua senha atual continua valendo.",
  },
  alreadyRegistered: {
    subject: "Você já tem uma conta",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    /**
     * The link in THIS message is a RESET link, not a sign-in one — see
     * `signup.ts`: the overwhelmingly common cause is a returning user who
     * forgot they had an account, and the second most common is one who forgot
     * the password. So it words a lifetime like the other token mails, and its
     * button says what the button actually does. Calling it "Entrar" would send
     * somebody to a choose-a-new-password form expecting a sign-in.
     */
    lead: ({ validFor }) =>
      `Alguém tentou criar uma conta com este e-mail, e você já tem uma. Se foi você, entre normalmente — ou use o link abaixo para definir uma nova senha. Ele vale por ${validFor}.`,
    cta: "Definir uma nova senha",
    footer:
      "Se não foi você, pode ignorar esta mensagem com segurança. Nenhuma conta nova foi criada.",
  },
  passwordChanged: {
    subject: "Sua senha foi alterada",
    greeting: (name) => (name?.trim() ? `Olá, ${name.trim()}` : "Olá"),
    lead: () =>
      "Sua senha foi alterada agora há pouco. Se foi você, não precisa fazer nada.",
    cta: "Entrar",
    footer:
      "Se NÃO foi você, peça uma nova senha imediatamente — quem fez a alteração pode estar com acesso à sua conta.",
  },
};

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

/** Render one of the four, from a pack and what the flow knows. */
export function renderAuthMail(
  pack: MailPack,
  kind: "verification" | "passwordReset" | "alreadyRegistered" | "passwordChanged",
  message: AuthEmailMessage,
  now: number = Date.now(),
): RenderedMail {
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
