import { describe, expect, it } from 'vitest';

import { PT_BR_EMAIL_CHROME } from '../chrome.pt-BR';
import { renderEmail, renderEmailHtml, safeHref, type EmailDocument } from '../template';
import { renderEmailText } from '../text';

/**
 * The layout's contract.
 *
 * Every case here is a property a mail client, a spam filter or an attacker
 * cares about — none is "the markup looks like this". A test asserting exact
 * HTML would fail on every styling tweak and would still not notice the two
 * failures that matter: an unescaped store name, and a text half that says less
 * than the HTML one.
 */
function documentOf(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    subject: 'Your order is confirmed',
    heading: 'Your order is confirmed',
    paragraphs: ['We received your payment.'],
    chrome: PT_BR_EMAIL_CHROME,
    brand: 'Acme',
    locale: 'en-US',
    ...overrides,
  };
}

describe('renderEmailHtml', () => {
  it('renders a complete document, not a fragment', () => {
    const html = renderEmailHtml(documentOf());
    // A `div` with a max-width inherits the client's own defaults — 13px Arial
    // in Gmail, Times New Roman in Outlook. The doctype is what puts Outlook in
    // standards mode.
    expect(html.startsWith('<!DOCTYPE html')).toBe(true);
    expect(html).toContain('</html>');
  });

  it("carries the reader's language on the document", () => {
    expect(renderEmailHtml(documentOf({ locale: 'pt-BR' }))).toContain('lang="pt-BR"');
  });

  it('escapes everything it interpolates', () => {
    const html = renderEmailHtml(
      documentOf({
        heading: 'Acme <script>alert("x")</script> & Co',
        paragraphs: ['Order "A-1" <b>paid</b>'],
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; Co');
  });

  it('names the brand it was given and never one of its own', () => {
    const html = renderEmailHtml(documentOf({ brand: 'Northwind' }));
    expect(html).toContain('Northwind');
  });

  it('puts a preheader in the body and falls back to the first paragraph', () => {
    expect(renderEmailHtml(documentOf({ preheader: 'Short summary' }))).toContain('Short summary');
    // Without one, the inbox list shows whatever text comes first — which on a
    // mail with a footer is the legal line.
    expect(renderEmailHtml(documentOf())).toContain('We received your payment.');
  });

  it('prints the fallback address whenever there is a button', () => {
    const html = renderEmailHtml(
      documentOf({ action: { label: 'View order', href: 'https://app.example/orders/1' } }),
    );
    expect(html).toContain('https://app.example/orders/1');
    // Corporate gateways rewrite link targets; the pasteable address is the
    // only way back in for a reader whose gateway mangles the button.
    expect(html).toContain(PT_BR_EMAIL_CHROME.fallbackHint);
  });

  it('gives the button a bgcolor attribute as well as a background style', () => {
    const html = renderEmailHtml(
      documentOf({ action: { label: 'Sign in', href: 'https://app.example/login' } }),
    );
    // Outlook reads the attribute and ignores the property. A button that loses
    // its fill is invisible ink on white.
    expect(html).toMatch(/<td[^>]*bgcolor="#[0-9A-Fa-f]{6}"[^>]*background:#/);
  });

  it('renders a facts table with the emphasised row intact', () => {
    const html = renderEmailHtml(
      documentOf({ facts: [{ label: 'Total', value: '$74.50', emphasis: true }] }),
    );
    expect(html).toContain('Total');
    expect(html).toContain('$74.50');
    expect(html).toContain('font-weight:700');
  });

  it('marks every layout table role="presentation"', () => {
    const html = renderEmailHtml(documentOf({ facts: [{ label: 'Order', value: 'A-1' }] }));
    // A screen reader must read the message, not announce a grid.
    expect(html.match(/<table/g)?.length).toBe(html.match(/role="presentation"/g)?.length);
  });

  it('takes a theme, and defaults to the neutral one', () => {
    const themed = renderEmailHtml(
      documentOf({
        action: { label: 'Go', href: 'https://app.example' },
        theme: {
          page: '#000001',
          surface: '#000002',
          panel: '#000003',
          border: '#000004',
          ink: '#000005',
          muted: '#000006',
          accent: '#000007',
          onAccent: '#000008',
          rule: '#000009',
        },
      }),
    );
    expect(themed).toContain('#000007');
    // The default is neutral, never a brand's.
    expect(renderEmailHtml(documentOf())).not.toContain('#000007');
  });
});

describe('renderEmailText', () => {
  it('says everything the HTML half says', () => {
    const document = documentOf({
      facts: [{ label: 'Order', value: 'A-1' }],
      action: { label: 'View order', href: 'https://app.example/o/1' },
      notes: ['If this was not you, ignore this message.'],
    });
    const text = renderEmailText(document);
    expect(text).toContain('Your order is confirmed');
    expect(text).toContain('Order: A-1');
    expect(text).toContain('https://app.example/o/1');
    expect(text).toContain('If this was not you, ignore this message.');
    expect(text).toContain(PT_BR_EMAIL_CHROME.automated);
  });

  it('is plain text — no markup leaks into it', () => {
    expect(renderEmailText(documentOf())).not.toMatch(/<[a-z]/i);
  });

  it('never collapses to nothing, so no mail ships html-only', () => {
    // A text/html part with no text/plain twin is scored by every major spam
    // filter, and it is what a watch or a terminal client shows.
    expect(renderEmailText(documentOf()).trim().length).toBeGreaterThan(20);
  });
});

describe('safeHref', () => {
  it('keeps the schemes a mail may use', () => {
    expect(safeHref('https://app.example/x')).toContain('https://app.example/x');
    expect(safeHref('mailto:ana@example.com')).toContain('mailto:ana@example.com');
    expect(safeHref('/orders/1')).toBe('/orders/1');
  });

  it('refuses anything else rather than linking somewhere unexpected', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#');
    expect(safeHref('data:text/html,<script>')).toBe('#');
    expect(safeHref('not a url')).toBe('#');
  });
});

describe('renderEmail', () => {
  it('returns the three parts a driver is handed', () => {
    const message = renderEmail(documentOf());
    expect(Object.keys(message).sort()).toEqual(['html', 'subject', 'text']);
    expect(message.subject).toBe('Your order is confirmed');
  });
});
