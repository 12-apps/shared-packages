import type { JSX } from "react";

/**
 * The webmail's own mark, beside its name on the "open your inbox" button
 * (FUT-3533). Recognising the logo is faster than reading the label, and it
 * is what tells the person the button leaves for their mail rather than
 * staying here.
 *
 * Inline SVG rather than image files: three tiny marks, no request, and they
 * scale with the button's icon slot. Decorative — the label names the
 * provider — so each is `aria-hidden`.
 */

function GmailLogo(): JSX.Element {
  return (
    <svg viewBox="0 0 24 18" width="1em" height="1em" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M1.64 18h3.82V8.73L0 4.64v11.73C0 17.27.73 18 1.64 18z" />
      <path fill="#34A853" d="M18.55 18h3.81c.9 0 1.64-.73 1.64-1.64V4.64l-5.45 4.09z" />
      <path fill="#FBBC04" d="M18.55 1.64v7.09L24 4.64V2.45C24 .43 21.69-.73 20.07.49z" />
      <path fill="#EA4335" d="M5.45 8.73V1.64L12 6.55l6.55-4.91v7.09L12 13.64z" />
      <path fill="#C5221F" d="M0 2.45v2.19l5.45 4.09V1.64L3.93.49C2.31-.73 0 .43 0 2.45z" />
    </svg>
  );
}

function OutlookLogo(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
      <rect x="8" y="3" width="15" height="18" rx="2" fill="#28A8EA" />
      <path fill="#0364B8" d="M8 12h15v7a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" />
      <rect x="1" y="6" width="12" height="12" rx="1.5" fill="#0078D4" />
      <ellipse cx="7" cy="12" rx="3" ry="3.6" fill="none" stroke="#fff" strokeWidth="1.8" />
    </svg>
  );
}

function YahooLogo(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="5" fill="#6001D2" />
      <path fill="#fff" d="M5 7h3l2.3 5.4L12.6 7h2.9l-4.4 9.6V20H8.6v-3.4zm11.6 0h3l-2.6 7h-2.4z" />
      <circle cx="16.3" cy="16.6" r="1.4" fill="#fff" />
    </svg>
  );
}

const LOGOS: Readonly<Record<string, () => JSX.Element>> = {
  Gmail: GmailLogo,
  Outlook: OutlookLogo,
  Yahoo: YahooLogo,
};

/** The provider's mark, or nothing for a name this file has no mark for. */
export function InboxLogo({ provider }: { provider: string }): JSX.Element | null {
  const Logo = LOGOS[provider];
  return Logo ? <Logo /> : null;
}
