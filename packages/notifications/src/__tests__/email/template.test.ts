import { describe, expect, it } from 'vitest';

import { PT_BR_EMAIL_CHROME } from '../../email/chrome.pt-BR';
import { NEUTRAL_EMAIL_THEME } from '../../email/theme';
import { renderEmail, renderEmailHtml, safeHref, type EmailDocument } from '../../email/template';
import { renderEmailText } from '../../email/text';

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

describe('the hero image', () => {
  const hero = {
    src: 'https://shop.example/papi/primeiro-pedido.png',
    alt: 'Papi holding a star',
    width: 96,
  };

  it('renders above the heading, square by default, with its size on the tag', () => {
    const html = renderEmailHtml(documentOf({ hero }));
    const img = html.indexOf('<img src="https://shop.example/papi/primeiro-pedido.png"');
    expect(img).toBeGreaterThan(-1);
    expect(img).toBeLessThan(html.indexOf('<h1'));
    expect(html).toContain('alt="Papi holding a star" width="96" height="96"');
  });

  it('escapes what it is given, like every other caller value', () => {
    const html = renderEmailHtml(documentOf({ hero: { ...hero, alt: '"><script>' } }));
    expect(html).not.toContain('"><script>');
  });

  it.each(['http://shop.example/a.png', '/papi/a.png', 'javascript:alert(1)', 'data:image/png;base64,AA'])(
    'drops a src that is not an absolute https URL: %s',
    (src) => {
      expect(renderEmailHtml(documentOf({ hero: { ...hero, src } }))).not.toContain('<img');
    },
  );

  it.each([0, -8, Number.NaN])('drops a hero whose width cannot be drawn: %s', (width) => {
    expect(renderEmailHtml(documentOf({ hero: { ...hero, width } }))).not.toContain('<img');
  });

  it('leaves the layout exactly as it was without one', () => {
    expect(renderEmailHtml(documentOf({ hero: undefined }))).toBe(renderEmailHtml(documentOf()));
    expect(renderEmailHtml(documentOf())).not.toContain('<img');
  });
});

describe('the unsubscribe line', () => {
  const unsubscribe = {
    label: 'Stop receiving',
    href: 'https://app.test/unsubscribe?t=a1&u=2',
    reason: 'You receive this because Ana included you.',
  };

  it('closes the body, inline after the reason and in the link colour', () => {
    const html = renderEmailHtml(documentOf({ notes: ['Sent on Monday.'], unsubscribe }));
    expect(html).toContain('You receive this because Ana included you. <a href="https://app.test/unsubscribe?t=a1&amp;u=2"');
    expect(html).toContain('>Stop receiving</a>');
    expect(html).toContain(`color:${NEUTRAL_EMAIL_THEME.accent};text-decoration:underline`);
    // After the notes, before the footer's rule and its legal line.
    expect(html.indexOf('Sent on Monday.')).toBeLessThan(html.indexOf('Stop receiving'));
    expect(html.indexOf('Stop receiving')).toBeLessThan(html.indexOf(PT_BR_EMAIL_CHROME.automated));
  });

  it('keeps a 40px tap target without moving the line', () => {
    const html = renderEmailHtml(documentOf({ unsubscribe }));
    const style = /<a href="[^"]*" style="([^"]*)">Stop receiving/.exec(html)?.[1] ?? '';
    expect(style).toContain('display:inline-block');
    const padding = Number(/padding:(\d+)px/.exec(style)?.[1]);
    expect(padding * 2 + 13 * 1.5).toBeGreaterThanOrEqual(40);
    expect(style).toContain(`margin:-${padding}px`);
  });

  it('is the link alone when there is no reason', () => {
    const html = renderEmailHtml(documentOf({ unsubscribe: { label: unsubscribe.label, href: unsubscribe.href } }));
    expect(html).toContain('<p style="margin:16px 0 8px;font-size:13px;line-height:1.5;color:#');
    expect(html).not.toContain('You receive this');
  });

  it('is the reason, then label and address, in the text twin, before the footer', () => {
    const lines = renderEmailText(documentOf({ unsubscribe })).split('\n');
    const at = lines.indexOf('You receive this because Ana included you.');
    expect(lines[at + 1]).toBe('Stop receiving: https://app.test/unsubscribe?t=a1&u=2');
    expect(at).toBeLessThan(lines.indexOf('--'));
  });

  it('is independent of the call to action: both can be present', () => {
    const action = { label: 'Open', href: 'https://app.test/r/1' };
    const html = renderEmailHtml(documentOf({ action, unsubscribe }));
    expect(html).toContain('>Open</a>');
    expect(html).toContain('>Stop receiving</a>');
    expect(renderEmailText(documentOf({ action }))).not.toContain('Stop receiving');
  });

  it('escapes its label and reason', () => {
    const html = renderEmailHtml(documentOf({ unsubscribe: { ...unsubscribe, label: '<b>Stop</b>', reason: 'A & B' } }));
    expect(html).toContain('&lt;b&gt;Stop&lt;/b&gt;');
    expect(html).toContain('A &amp; B ');
  });

  it.each(['javascript:alert(1)', '', 'not a url'])('refuses an unsafe address loudly, in both halves: %j', (href) => {
    const document = documentOf({ unsubscribe: { label: 'Stop', href } });
    expect(() => renderEmailHtml(document)).toThrow(/unsubscribe/);
    expect(() => renderEmailText(document)).toThrow(/unsubscribe/);
  });

  it('leaves both halves exactly as they were without one', () => {
    expect(renderEmailHtml(documentOf({ unsubscribe: undefined }))).toBe(renderEmailHtml(documentOf()));
    expect(renderEmailText(documentOf({ unsubscribe: undefined }))).toBe(renderEmailText(documentOf()));
    expect(renderEmail(documentOf({ unsubscribe })).html).toContain('Stop receiving');
    expect(renderEmail(documentOf()).text).not.toContain('Stop receiving');
  });
});
