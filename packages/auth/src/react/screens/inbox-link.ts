/**
 * The webmail a confirmation e-mail lands in, and a link that opens it there.
 *
 * "Confira seu e-mail" leaves the person to find a tab, open their mail and
 * hunt for one message among the rest; the button this feeds takes them to it
 * in one tap. Only providers we can name from the address alone get one: a
 * company domain could be any of them, and a button that opens the wrong
 * webmail is worse than none.
 *
 * `sender` is what the search matches — a display name or an address, the
 * host's (`EmailAuthScreensConfig.inboxSender`). Where a provider has no
 * search link (Outlook.com does not take one), the link opens that account's
 * inbox instead, which is still the tab the person was about to look for.
 */

export interface InboxLink {
  /** The provider's own name, for the button's label. */
  provider: string;
  href: string;
}

interface Provider {
  name: string;
  /** Matches the domain of the address, lower-cased. */
  domain: RegExp;
  link: (email: string, sender: string | undefined) => string;
}

/**
 * Gmail search, limited to the last hour and to every folder — `in:anywhere`
 * so a message the spam filter took is found too. `/u/<email>/` picks the
 * right account for somebody signed in to several.
 */
function gmail(email: string, sender: string | undefined): string {
  const account = `https://mail.google.com/mail/u/${encodeURIComponent(email)}/`;
  if (!sender) return account;
  const query = encodeURIComponent(`from:${sender} in:anywhere newer_than:1h`);
  return `${account}#search/${query}`;
}

function outlook(email: string): string {
  return `https://outlook.live.com/mail/0/?login_hint=${encodeURIComponent(email)}`;
}

function yahoo(_email: string, sender: string | undefined): string {
  if (!sender) return "https://mail.yahoo.com/";
  // Yahoo reads the keyword encoded twice.
  return `https://mail.yahoo.com/d/search/keyword=${encodeURIComponent(encodeURIComponent(`from:${sender}`))}`;
}

const PROVIDERS: readonly Provider[] = [
  { name: "Gmail", domain: /^(gmail|googlemail)\.com$/, link: gmail },
  // The country variants are the common case in Brazil (`hotmail.com.br`).
  { name: "Outlook", domain: /^(hotmail|outlook|live|msn)(\.com)?(\.[a-z]{2})?$/, link: outlook },
  { name: "Yahoo", domain: /^(yahoo|ymail)(\.com)?(\.[a-z]{2})?$/, link: yahoo },
];

/** The link for `email`'s webmail, or `null` when the address does not say which. */
export function inboxLink(email: string, sender?: string): InboxLink | null {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return null;
  const provider = PROVIDERS.find((candidate) => candidate.domain.test(domain));
  if (!provider) return null;
  return { provider: provider.name, href: provider.link(email.trim(), sender?.trim() || undefined) };
}
