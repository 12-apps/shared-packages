# Adopting @12-apps/email

This package is **one transactional-mail layout, and a console that previews
every message a host can send**. A host points at these surfaces; when the
library updates, every host updates with no app changes. The contract is the one
`@12-apps/notifications`, `@12-apps/rbac`, `@12-apps/i18n` and
`@12-apps/payments-*` established.

What it gives a host: a **document model** rendered to an HTML/plain-text pair
from the same object, with the mail-client constraints encoded once; and a
**source-agnostic preview catalogue** with its endpoints and its operator
screen, so a mail can be looked at without triggering the event that sends it.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core** | `@12-apps/email` | `renderEmail(document)` → `{ subject, html, text }`. Framework-free, dependency-free, safe in a browser, a job or a webhook. Nothing to wire. |
| **Locales** | `@12-apps/email/locales` | `EMAIL_CHROME`, the layout's own three sentences per language. Passed BY NAME — there is no default in any language. |
| **Server** | `@12-apps/email/server` | `createEmailPreviews({ sources, locales, defaultLocale })` for the catalogue, or `emailPreviewRoutes(config)` for the two descriptors to mount. |
| **Hono** | `@12-apps/email/hono` | `const previews = emailPreviewsRouter(config); app.route('/api/platform/email-previews', previews.router)`. `hono` is an OPTIONAL peer, so importing the root, `/server` or `/react` never resolves it. |
| **React** | `@12-apps/email/react` | `createEmailPreviewScreen({ apiBase, copy })`. `page` is the screen you route to; `PT_BR_EMAIL_PREVIEW_COPY` / `EN_US_EMAIL_PREVIEW_COPY` are the packs to choose between. |
| **Manifest** | `@12-apps/email/manifest`, `/manifest/server`, `/manifest/web` | The wiring contract's producer half: `http` and `surface`. No `db` — nothing here is persisted. |

## Host wiring rules (the ones that bite)

### 1. The BRAND and the CHROME are required, and neither has a default

`EmailDocument` takes `brand` and `chrome`, both required. A package that
defaulted the brand would sign another company's mail, and one that defaulted
the chrome would put a language nobody chose in somebody's inbox. So:

```ts
import { renderEmail } from '@12-apps/email';
import { EMAIL_CHROME } from '@12-apps/email/locales';
import { selectCopy } from '@12-apps/i18n';

renderEmail({
  subject: copy.subject,
  heading: copy.heading,
  paragraphs: [copy.lead],
  action: { label: copy.cta, href: link },
  brand: 'Northwind',                              // yours
  locale: recipientLocale,                         // the READER's, not the request's
  chrome: selectCopy(EMAIL_CHROME, recipientLocale),
});
```

`@12-apps/i18n` is not required — a host with one audience passes
`PT_BR_EMAIL_CHROME` (or the `en-US` pack) by name and never installs it.

### 2. The reader's language is the RECIPIENT's, and it is resolved PER MESSAGE

`chrome` is a value on the document rather than a resolver on a mount, and that
is deliberate: a mailer built once per process and closed over one pack writes
every message that deployment ever sends in the same language, and a
single-locale host cannot tell the difference.

The tag is the recipient's own — never the request's. The person who triggers a
mail is routinely not the person who reads it: a "your password changed" notice
is caused by a request that may be an attacker's, and a receipt is sent by a
job with no request at all.

### 3. A THEME may be omitted; copy may not

`NEUTRAL_EMAIL_THEME` is grey on white — not anybody's brand. A host that passes
nothing gets a plain mail, not a mail that looks like a different company, which
is exactly why this one is allowed a default where the copy is not.

If you do pass a theme, the one value that matters is `accent`: it is the CTA
fill and every link, and it must clear **4.5:1 against white**. A warm mid-tone
that looks fine on a screen is unreadable in an inbox, and nothing in the
pipeline will say so.

### 4. A SOURCE is asked per request — that is what makes the catalogue complete

```ts
const previews = {
  sources: [
    {
      owner: '@12-apps/auth',
      list: () => AUTH_MAIL_KINDS.map((kind) => ({
        id: `auth:${kind}`,
        key: kind,
        family: 'account access',
        render: (locale) => renderEmail(authMailDocument(kind, SAMPLE, locale)),
      })),
    },
    {
      owner: 'apps/web',
      list: () => [...registeredGenerators()].filter(hasSample).map(toPreviewMessage),
      coverage: () => ({ missing: typesWithNoSample(), orphan: samplesWithNoType() }),
    },
  ],
  locales: ['pt-BR', 'en-US'],
  defaultLocale: 'pt-BR',
};
```

`list()` runs on every request rather than once at the mount. Domain modules
typically register their messages as an import side effect, so a catalogue built
once would list whatever happened to be imported first — which looks exactly
like a product that sends fewer mails than it does.

**Ids must be unique across every source.** Two sources sharing one makes one
message unreachable and the other ambiguous, silently, so
`DuplicateEmailPreviewIdError` is thrown on the request that would have hidden
it.

### 5. `coverage` is optional, and worth writing

A catalogue that quietly omits a message looks exactly like a product that does
not send it. Report what you cannot show — a message with no sample data, or
sample data for a message that no longer exists — and the screen renders it as a
warning strip instead of pretending to be complete. Pair it with a unit test
asserting `missing` is empty, and a mail added without a sample becomes a red
test naming the type rather than a gap nobody sees.

### 6. YOU gate the mount. The routes do not

`emailPreviewRoutes` declares `session: false` on both descriptors, because this
package cannot know who a host lets look. **That is not an invitation to mount
them open.**

The surface publishes a host's whole transactional-mail inventory and the exact
wording and link shape of its verification and password-reset mails — the
reference somebody writing a convincing phishing mail for that product would
want. Mount it behind whichever gate the host already uses for platform staff:

```ts
app.use('/api/platform/email-previews/*', requirePlatformOperator);
app.route('/api/platform/email-previews', emailPreviewsRouter(previews).router);
```

`emailPreviewsHonoConfig.allow` is there for a host that would rather state the
refusal once in the config than mount middleware around the router. Either is
fine; neither is optional.

### 7. Nothing can be sent from the preview surface

By construction, not by convention: the surface holds no driver, no transport
and no address, and `render` is pure by the contract `EmailPreviewMessage`
states. The one mistake a preview surface must be incapable of — putting a
sample in somebody's inbox — is not reachable from this code.

## What stays the host's, permanently

The brand. The theme. Every sentence in every message. Which messages exist and
what sample data they render from. Who may look. This package owns the document
and the catalogue, and nothing else — which is what lets one repo's mail look
like one product without any two repos' mail looking like each other.
