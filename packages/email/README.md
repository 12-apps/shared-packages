# @12-apps/email

One transactional-mail layout, and a console that previews every message a host
can send.

```bash
pnpm add @12-apps/email
```

## The layout

A document model in, an HTML/plain-text pair out:

```ts
import { renderEmail } from '@12-apps/email';
import { PT_BR_EMAIL_CHROME } from '@12-apps/email/locales';

const { subject, html, text } = renderEmail({
  subject: 'Pagamento confirmado',
  heading: 'Pagamento confirmado',
  paragraphs: ['Recebemos o seu pagamento de R$ 74,50.'],
  facts: [{ label: 'Valor', value: 'R$ 74,50', emphasis: true }],
  action: { label: 'Ver detalhes', href: 'https://app.example/o/1' },
  brand: 'Northwind',
  locale: 'pt-BR',
  chrome: PT_BR_EMAIL_CHROME,
});
```

Callers hand over **structure and never markup**, which is what makes three
things true at once: escaping happens in one place, the plain-text twin cannot
say less than the HTML one, and a preview renders exactly what a send would.

The mail-client constraints are encoded once, so no caller has to know them —
tables rather than divs (Outlook lays HTML out with Word), inline styles only
(Gmail strips `<style>`), no web fonts or `color-mix()` or CSS variables, a
hidden preheader, a `bgcolor` attribute **and** a background style on the CTA,
and `role="presentation"` on every layout table.

## The preview console

A host declares SOURCES — which messages exist is the one thing a package cannot
know — and gets a catalogue, two endpoints and an operator screen:

```ts
import { emailPreviewsRouter } from '@12-apps/email/hono';
import { createEmailPreviewScreen, PT_BR_EMAIL_PREVIEW_COPY } from '@12-apps/email/react';

app.use('/api/platform/email-previews/*', requirePlatformOperator);
app.route('/api/platform/email-previews', emailPreviewsRouter({
  sources, locales: ['pt-BR', 'en-US'], defaultLocale: 'pt-BR',
}).router);

const { page } = createEmailPreviewScreen({
  apiBase: '/api/platform/email-previews',
  copy: PT_BR_EMAIL_PREVIEW_COPY,
});
```

The screen groups by the package that owns each message — which is the answer to
"which parts of this system send mail" — renders in either language, shows the
plain-text twin on its own tab, and previews at desktop or phone width in a
`sandbox=""` frame.

**Nothing can be sent from it.** The surface holds no driver and `render` is
pure.

## What stays yours

The brand, the theme, every sentence, which messages exist, and who may look.
See [ADOPTING.md](./ADOPTING.md).
