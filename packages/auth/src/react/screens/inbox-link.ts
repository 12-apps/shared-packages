/**
 * The webmail a confirmation e-mail lands in, and a link that opens it there.
 *
 * "Confira seu e-mail" leaves the person to find a tab, open their mail and
 * hunt for one message among the rest; the button this feeds takes them to it
 * in one tap. Only providers we can name from the address alone get one: a
 * company domain could be any of them, and a button that opens the wrong
 * webmail is worse than none — which is why a company domain is named only by
 * its MX records, read on the server (`host`).
 *
 * `sender` is what the search matches — a display name or an address, the
 * host's (`EmailAuthScreensConfig.inboxSender`). Where a provider has no
 * search link (Outlook.com does not take one), the link opens that account's
 * inbox instead, which is still the tab the person was about to look for.
 */

interface InboxLink {
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
 * Gmail search, limited to the last day and to every folder — `in:anywhere`
 * so a message the spam filter took is found too. A day rather than an hour:
 * the page stays open, and somebody who comes back to it later must not meet
 * an empty search.
 *
 * `/u/0/` — the browser's default Gmail account — and never `/u/<address>/`.
 * The address-shaped slot only resolves an address Gmail has signed in under
 * that exact spelling: a `+alias` (`ana+loja@gmail.com`), or a person signed in
 * as somebody else, gets Gmail's "Temporary Error (404)" page instead of an
 * inbox (FUT-3533, seen in production). A person signed in to several accounts
 * may land on their main one; that is an inbox and a switcher, not an error.
 */
function gmail(_email: string, sender: string | undefined): string {
  const account = "https://mail.google.com/mail/u/0/";
  if (!sender) return account;
  const query = encodeURIComponent(`from:${searchTerm(sender)} in:anywhere newer_than:1d`);
  return `${account}#search/${query}`;
}

/** A sender of several words, quoted, so the search reads it as one name. */
function searchTerm(sender: string): string {
  return /\s/u.test(sender) ? `"${sender.replaceAll('"', "")}"` : sender;
}

function outlook(email: string): string {
  return `https://outlook.live.com/mail/0/?login_hint=${encodeURIComponent(email)}`;
}

/** Microsoft 365: a work or school account reads its mail here, not on outlook.live.com. */
function office(email: string): string {
  return `https://outlook.office.com/mail/?login_hint=${encodeURIComponent(email)}`;
}

function yahoo(_email: string, sender: string | undefined): string {
  if (!sender) return "https://mail.yahoo.com/";
  // Yahoo reads the keyword encoded twice.
  return `https://mail.yahoo.com/d/search/keyword=${encodeURIComponent(encodeURIComponent(`from:${searchTerm(sender)}`))}`;
}

/** A webmail with no search link this module knows: its inbox, the tab the person was about to open. */
const inbox =
  (href: string) =>
  (): string =>
    href;

/** `.com`, or a country's own: `.com.br`, `.co.uk`, `.fr`. */
const TLD = String.raw`\.(com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})$`;

/**
 * A webmail the server read off a domain's MX records (`../../server/inbox-host`),
 * by key, so the wire carries a word rather than a link it would have to be
 * trusted for.
 */
export type InboxHost =
  | "google"
  | "microsoft"
  | "titan"
  | "zoho"
  | "yahoo"
  | "icloud"
  | "proton"
  | "locaweb";

const GMAIL: Omit<Provider, "domain"> = { name: "Gmail", link: gmail };
const YAHOO: Omit<Provider, "domain"> = { name: "Yahoo", link: yahoo };
const ICLOUD: Omit<Provider, "domain"> = { name: "iCloud", link: inbox("https://www.icloud.com/mail/") };
const PROTON: Omit<Provider, "domain"> = { name: "Proton", link: inbox("https://mail.proton.me/") };

const PROVIDERS: readonly Provider[] = [
  { ...GMAIL, domain: /^(gmail|googlemail)\.com$/ },
  // The country variants are the common case in Brazil (`hotmail.com.br`).
  { name: "Outlook", domain: new RegExp(`^(hotmail|outlook|live|msn)${TLD}`), link: outlook },
  { ...YAHOO, domain: new RegExp(`^(yahoo|ymail)${TLD}`) },
  { ...ICLOUD, domain: /^(icloud|me|mac)\.com$/ },
  // AOL's MX is Yahoo's, so the server's lookup would say Yahoo: named here
  // first, by the address, with its own webmail.
  { name: "AOL", domain: /^aol\.com(\.br)?$/, link: inbox("https://mail.aol.com/") },
  { name: "UOL", domain: /^uol\.com\.br$/, link: inbox("https://email.uol.com.br/") },
  { name: "BOL", domain: /^bol\.com\.br$/, link: inbox("https://email.bol.uol.com.br/") },
  { ...PROTON, domain: /^(proton\.me|protonmail\.com|pm\.me)$/ },
];

/** The webmail behind each MX key. Gmail and Yahoo keep their search links. */
const BY_HOST: Readonly<Record<InboxHost, Omit<Provider, "domain">>> = {
  google: GMAIL,
  microsoft: { name: "Outlook", link: office },
  titan: { name: "Titan", link: inbox("https://app.titan.email/") },
  zoho: { name: "Zoho", link: inbox("https://mail.zoho.com/") },
  yahoo: YAHOO,
  icloud: ICLOUD,
  proton: PROTON,
  // "Abrir o webmail da Locaweb": the copy reads "Abrir o <name>", and the
  // company is feminine, so the name carries its own article.
  locaweb: { name: "webmail da Locaweb", link: inbox("https://webmail-seguro.com.br/") },
};

/**
 * Whether the address's own domain names its webmail — the server's MX lookup
 * skips those, since the answer could only agree.
 */
export function inboxProviderOfDomain(domain: string): boolean {
  const lower = domain.trim().toLowerCase();
  return PROVIDERS.some((candidate) => candidate.domain.test(lower));
}

/**
 * The link for `email`'s webmail, or `null` when nothing says which.
 *
 * The address's own domain decides first. Only when it is not a public one
 * does `host` — the server's reading of the domain's MX — get a say; a key
 * this build does not know is ignored rather than guessed at.
 */
export function inboxLink(email: string, sender?: string, host?: string | null): InboxLink | null {
  const address = email.trim();
  const parts = address.toLowerCase().split("@");
  const domain = parts.length === 2 ? parts[1] : undefined;
  if (!domain) return null;
  const sendTo = sender?.trim() || undefined;
  const provider =
    PROVIDERS.find((candidate) => candidate.domain.test(domain)) ??
    (host && Object.hasOwn(BY_HOST, host) ? BY_HOST[host as InboxHost] : undefined);
  if (!provider) return null;
  return { provider: provider.name, href: provider.link(address, sendTo) };
}
