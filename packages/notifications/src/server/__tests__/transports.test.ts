import { describe, expect, it, vi } from 'vitest';

import type { NotificationContent, TransportRecipient } from '../../types';
import { NotificationProviderError, type FetchImpl } from '../transports/drivers';
import { emailTransport, formatEmail } from '../transports/email';
import { createTransportRegistry } from '../transports/registry';
import { formatSms, smsTransport } from '../transports/sms';
import {
  webPushTransport,
  type WebPushSubscriptionSource,
} from '../transports/web-push';
import { formatWhatsApp, whatsAppTransport } from '../transports/whatsapp';

/**
 * The transports and their vendor DRIVERS — the seam that replaced
 * future-pay's `process.env` reads, and the reason a second provider is a
 * config entry rather than a package change.
 */

const CONTENT: NotificationContent = {
  title: 'Pagamento confirmado',
  body: 'Pedido A1 pago.',
  link: '/orders/A1',
};

const reachable: TransportRecipient = {
  userId: 'u1',
  email: 'buyer@example.com',
  phone: '+5531999998888',
  pushSubscriptionCount: 2,
};

/** A fetch double recording exactly what crossed the wire. */
function recordingFetch(
  response: { ok: boolean; status: number; text?: string } = { ok: true, status: 200 },
): { fetchImpl: FetchImpl; calls: { url: string; init: unknown }[] } {
  const calls: { url: string; init: unknown }[] = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: response.ok,
        status: response.status,
        text: () => Promise.resolve(response.text ?? ''),
      });
    },
  };
}

describe('driver resolution', () => {
  it('names the drivers it knows when a vendor key is a typo', () => {
    // A typo'd vendor silently disabling a channel is the failure this seam
    // exists to remove, so it throws at MOUNT rather than at the first send.
    expect(() => emailTransport({ channel: 'EMAIL', driver: 'resnd' })).toThrow(
      /unknown EMAIL driver "resnd".*Known drivers: log, resend/s,
    );
  });

  it('accepts a HOST driver with no change to the package', () => {
    const sent: string[] = [];
    const transport = emailTransport(
      { channel: 'EMAIL', driver: 'ses' },
      { ses: () => ({ send: (to) => { sent.push(to); return Promise.resolve(); } }) },
    );
    expect(transport.channel).toBe('EMAIL');
    return transport.send(formatEmail(CONTENT, { channel: 'EMAIL', driver: 'ses' }), reachable).then(() => {
      expect(sent).toEqual(['buyer@example.com']);
    });
  });
});

describe('the email transport', () => {
  const declaration = {
    channel: 'EMAIL',
    driver: 'resend',
    apiKey: 'key_1',
    from: 'Loja <no-reply@example.com>',
    appUrl: 'https://loja.example.com',
  } as const;

  it('formats subject/text/html and turns the link into an absolute CTA', () => {
    const message = formatEmail(CONTENT, declaration);
    expect(message.subject).toBe('Pagamento confirmado');
    expect(message.text).toContain('https://loja.example.com/orders/A1');
    expect(message.html).toContain('<a href="https://loja.example.com/orders/A1">Ver detalhes</a>');
  });

  it('drops the link when no app URL is configured', () => {
    // A relative path is useless in an inbox and a fabricated localhost link is
    // worse than none.
    const message = formatEmail(CONTENT, { channel: 'EMAIL', driver: 'log' });
    expect(message.text).toBe('Pedido A1 pago.');
    expect(message.html).not.toContain('<a ');
  });

  it('escapes HTML in the content rather than rendering it', () => {
    const message = formatEmail(
      { title: '<script>x</script>', body: 'a & b "c"' },
      { channel: 'EMAIL', driver: 'log' },
    );
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('a &amp; b &quot;c&quot;');
  });

  it('POSTs to Resend with the key and the formatted body', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const transport = emailTransport({ ...declaration, fetchImpl });
    await transport.send(formatEmail(CONTENT, declaration), reachable);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    const init = calls[0]?.init as { headers: Record<string, string>; body: string };
    expect(init.headers.Authorization).toBe('Bearer key_1');
    const body = JSON.parse(init.body) as { to: string[]; subject: string };
    expect(body.to).toEqual(['buyer@example.com']);
    expect(body.subject).toBe('Pagamento confirmado');
  });

  it('throws with the provider status so the delivery row records it', async () => {
    const { fetchImpl } = recordingFetch({ ok: false, status: 422, text: 'invalid from' });
    const transport = emailTransport({ ...declaration, fetchImpl });
    await expect(
      transport.send(formatEmail(CONTENT, declaration), reachable),
    ).rejects.toThrow(NotificationProviderError);
    await expect(
      transport.send(formatEmail(CONTENT, declaration), reachable),
    ).rejects.toThrow(/Resend rejected the message \(422 invalid from\)/);
  });

  it('is unavailable for a recipient with no address, EMPTY STRING included', async () => {
    // `!== null` passed an empty string — a very ordinary value for a nullable
    // column — so the channel earned a delivery row and then failed forever
    // against `send`'s own truthiness check. Two gates, one answer.
    const transport = emailTransport({ channel: 'EMAIL', driver: 'log' });
    expect(transport.supports({ ...reachable, email: null })).toBe(false);
    expect(transport.supports({ ...reachable, email: '' })).toBe(false);
    expect(transport.supports(reachable)).toBe(true);
    await expect(
      transport.send(formatEmail(CONTENT, declaration), { ...reachable, email: '' }),
    ).rejects.toThrow(/no email address/);
  });

  it('logs no destination address on the log driver — an inbox address is PII', () => {
    const info = vi.fn();
    const transport = emailTransport({ channel: 'EMAIL', driver: 'log', logger: { info, error: vi.fn() } });
    return transport.send(formatEmail(CONTENT, declaration), reachable).then(() => {
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]?.[0])).not.toContain('buyer@example.com');
    });
  });
});

describe('the sms transport', () => {
  const declaration = {
    channel: 'SMS',
    driver: 'twilio',
    accountSid: 'AC1',
    authToken: 'tok',
    from: '+15550000000',
    appUrl: 'https://loja.example.com',
    defaultCountryCode: '55',
  } as const;

  it('formats one plain body and caps it at three billed segments', () => {
    expect(formatSms(CONTENT, declaration).body).toBe(
      'Pagamento confirmado: Pedido A1 pago. https://loja.example.com/orders/A1',
    );
    const long = formatSms({ title: 'T', body: 'x'.repeat(600) }, declaration);
    expect(long.body).toHaveLength(480);
    expect(long.body.endsWith('…')).toBe(true);
  });

  it('POSTs form-encoded to Twilio with basic auth and the E.164 destination', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const transport = smsTransport({ ...declaration, fetchImpl });
    await transport.send(formatSms(CONTENT, declaration), { ...reachable, phone: '31999998888' });

    const init = calls[0]?.init as { headers: Record<string, string>; body: string };
    expect(calls[0]?.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(init.headers.Authorization).toMatch(/^Basic /);
    const form = new URLSearchParams(init.body);
    // The bare local number was normalized before it reached the vendor.
    expect(form.get('To')).toBe('+5531999998888');
    expect(form.get('From')).toBe('+15550000000');
  });

  it('is unavailable for a recipient whose phone cannot be normalized', () => {
    const transport = smsTransport({ channel: 'SMS', driver: 'log', defaultCountryCode: '55' });
    expect(transport.supports({ ...reachable, phone: null })).toBe(false);
    expect(transport.supports({ ...reachable, phone: '123' })).toBe(false);
    expect(transport.supports(reachable)).toBe(true);
  });
});

describe('the whatsapp transport', () => {
  const base = {
    channel: 'WHATSAPP',
    driver: 'meta',
    accessToken: 'tok',
    phoneNumberId: '1234',
    appUrl: 'https://loja.example.com',
    defaultCountryCode: '55',
  } as const;

  it('formats bold title + body + absolute link, and the two template params', () => {
    const message = formatWhatsApp(CONTENT, base);
    expect(message.text).toBe(
      '*Pagamento confirmado*\n\nPedido A1 pago.\n\nhttps://loja.example.com/orders/A1',
    );
    expect(message.templateParameters).toEqual(['Pagamento confirmado', 'Pedido A1 pago.']);
  });

  it('sends FREE-FORM text with no template configured (session-window path)', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const transport = whatsAppTransport({ ...base, fetchImpl });
    await transport.send(formatWhatsApp(CONTENT, base), reachable);

    const init = calls[0]?.init as { body: string };
    const payload = JSON.parse(init.body) as { type: string; to: string };
    expect(payload.type).toBe('text');
    // The Cloud API addresses recipients by bare digits.
    expect(payload.to).toBe('5531999998888');
  });

  it('sends the approved TEMPLATE when one is named, in the host language', async () => {
    const declaration = {
      ...base,
      templateName: 'aviso_pagamento',
      templateLanguage: 'pt_BR',
    } as const;
    const { fetchImpl, calls } = recordingFetch();
    const transport = whatsAppTransport({ ...declaration, fetchImpl });
    await transport.send(formatWhatsApp(CONTENT, declaration), reachable);

    const payload = JSON.parse((calls[0]?.init as { body: string }).body) as {
      type: string;
      template: { name: string; language: { code: string }; components: { parameters: unknown[] }[] };
    };
    expect(payload.type).toBe('template');
    expect(payload.template.name).toBe('aviso_pagamento');
    expect(payload.template.language.code).toBe('pt_BR');
    expect(payload.template.components[0]?.parameters).toEqual([
      { type: 'text', text: 'Pagamento confirmado' },
      { type: 'text', text: 'Pedido A1 pago.' },
    ]);
  });

  it('WARNS at mount when no template is named — every business send is rejected', () => {
    // The 24h session window cannot be tracked from here, so a host that
    // declares WHATSAPP with no template and emits business-initiated alerts has
    // every send refused by Meta. The delivery rows record it, but only once they
    // exist; at mount it costs one line to notice. Not a throw: free-form is
    // correct for a host that only replies inside the window.
    const error = vi.fn();
    whatsAppTransport(base, {}, { info: vi.fn(), error });
    expect(String(error.mock.calls[0]?.[0])).toMatch(/no `templateName`/);

    error.mockClear();
    whatsAppTransport({ ...base, templateName: 'aviso_pagamento' }, {}, {
      info: vi.fn(),
      error,
    });
    expect(error).not.toHaveBeenCalled();
  });
});

describe('the web push transport', () => {
  /** A subscription source recording what was pruned. */
  function source(
    rows: { id: string; endpoint: string; p256dh: string; auth: string }[],
  ): WebPushSubscriptionSource & { pruned: string[] } {
    const pruned: string[] = [];
    return {
      pruned,
      list: () => Promise.resolve(rows),
      prune: (id) => {
        pruned.push(id);
        return Promise.resolve();
      },
    };
  }

  const rows = [
    { id: 's1', endpoint: 'https://push.example.com/a', p256dh: 'p1', auth: 'a1' },
    { id: 's2', endpoint: 'https://push.example.com/b', p256dh: 'p2', auth: 'a2' },
  ];

  it('is unavailable for a recipient with no registered browser', () => {
    const transport = webPushTransport({ channel: 'WEB_PUSH', driver: 'log' }, source(rows));
    expect(transport.supports({ ...reachable, pushSubscriptionCount: 0 })).toBe(false);
    expect(transport.supports(reachable)).toBe(true);
  });

  it('sends the SW payload to every browser the user holds', async () => {
    const seen: string[] = [];
    const transport = webPushTransport(
      {
        channel: 'WEB_PUSH',
        driver: 'vapid',
        sender: (subscription, payload) => {
          seen.push(`${subscription.endpoint}:${payload}`);
          return Promise.resolve();
        },
      },
      source(rows),
    );
    await transport.send(transport.format(CONTENT), reachable);
    expect(seen).toEqual([
      'https://push.example.com/a:{"title":"Pagamento confirmado","body":"Pedido A1 pago.","link":"/orders/A1","data":{}}',
      'https://push.example.com/b:{"title":"Pagamento confirmado","body":"Pedido A1 pago.","link":"/orders/A1","data":{}}',
    ]);
  });

  it('PRUNES a gone subscription (410) and still succeeds on the other', async () => {
    const subscriptions = source(rows);
    const transport = webPushTransport(
      {
        channel: 'WEB_PUSH',
        driver: 'vapid',
        sender: (subscription) => {
          if (subscription.endpoint.endsWith('/a')) {
            return Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }));
          }
          return Promise.resolve();
        },
      },
      subscriptions,
    );

    await expect(transport.send(transport.format(CONTENT), reachable)).resolves.toBeUndefined();
    expect(subscriptions.pruned).toEqual(['s1']);
  });

  it('does NOT prune on a transient failure, and fails when all errored', async () => {
    const subscriptions = source(rows);
    const transport = webPushTransport(
      {
        channel: 'WEB_PUSH',
        driver: 'vapid',
        sender: () => Promise.reject(Object.assign(new Error('push service down'), { statusCode: 503 })),
      },
      subscriptions,
    );

    await expect(transport.send(transport.format(CONTENT), reachable)).rejects.toThrow(
      /push service down/,
    );
    // A 503 is not evidence the browser is gone; pruning here would destroy a
    // live destination.
    expect(subscriptions.pruned).toEqual([]);
  });

  it('refuses the vapid driver with no signer, at mount', () => {
    expect(() => webPushTransport({ channel: 'WEB_PUSH', driver: 'vapid' }, source([]))).toThrow(
      /needs a `sender`/,
    );
  });
});

describe('the registry', () => {
  const subscriptions: WebPushSubscriptionSource = {
    list: () => Promise.resolve([]),
    prune: () => Promise.resolve(),
  };

  it('answers null for a channel the host never declared', () => {
    const registry = createTransportRegistry([{ channel: 'EMAIL', driver: 'log' }], subscriptions);
    expect(registry.get('EMAIL')).not.toBeNull();
    expect(registry.get('SMS')).toBeNull();
    expect(registry.list()).toHaveLength(1);
  });

  it('exposes the VAPID public key the browser needs to subscribe', () => {
    const registry = createTransportRegistry(
      [{ channel: 'WEB_PUSH', driver: 'log', publicKey: 'BPub' }],
      subscriptions,
    );
    expect(registry.webPushPublicKey()).toBe('BPub');
    expect(createTransportRegistry([], subscriptions).webPushPublicKey()).toBeNull();
  });

  it('refuses two declarations for one channel rather than silently keeping one', () => {
    expect(() =>
      createTransportRegistry(
        [
          { channel: 'EMAIL', driver: 'log' },
          { channel: 'EMAIL', driver: 'resend', apiKey: 'k', from: 'f' },
        ],
        subscriptions,
      ),
    ).toThrow(/declared twice/);
  });
});
