/* eslint-disable test-flakiness/no-global-state-mutation --
   the fetch double and the transport RECORD what crossed them; appending to
   those arrays is what the assertions read, and each case builds its own. */
import { describe, expect, it } from 'vitest';

import type { NotificationTransport, TransportRecipient } from '../../types';
import type { FetchImpl } from '../transports/drivers';
import {
  formatWhatsApp,
  whatsAppTransport,
  type WhatsAppDriverDeclaration,
  type WhatsAppMessage,
} from '../transports/whatsapp';

import { clinicConsent, consentOf, mountContract, mutableContacts } from './consent-contract';
import { createMemoryDb } from './memory-db';

/**
 * FUT-285 — the WhatsApp confirmation goes out as an APPROVED TEMPLATE the
 * host names (owner, 2026-11-16). Meta rejects a business-initiated free-form
 * message outside the 24 h window, and a confirmation is not the declaration's
 * generic "{{1}}: {{2}}" alert, so the consent engine puts the host's template
 * on the confirmation it builds. Review N6: only there — a notification's
 * `data` cannot name a template — and a body parameter carries no newline or
 * tab, which Meta rejects.
 */

const recipient: TransportRecipient = {
  userId: 'u1',
  email: null,
  phone: '+5511987654321',
  clientId: null,
  side: null,
  pushSubscriptionCount: 0,
};

const declaration: WhatsAppDriverDeclaration = {
  channel: 'WHATSAPP',
  driver: 'meta',
  accessToken: 'token',
  phoneNumberId: '106540352242922',
  templateName: 'generic_alert',
  templateLanguage: 'en_US',
  defaultCountryCode: '55',
};

function recordingFetch(): { fetchImpl: FetchImpl; bodies: unknown[] } {
  const bodies: unknown[] = [];
  return {
    bodies,
    fetchImpl: (_url, init) => {
      bodies.push(JSON.parse(init?.body ?? 'null'));
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('{"messages":[{"id":"wamid.1"}]}'),
      });
    },
  };
}

describe('a message that carries its own template', () => {
  it('is sent as that template: name, language, body parameters and quick-reply payloads', async () => {
    const { fetchImpl, bodies } = recordingFetch();
    const transport = whatsAppTransport({ ...declaration, fetchImpl });
    const message: WhatsAppMessage = {
      ...transport.format({ title: 'Confirm', body: 'Reply YES' }),
      template: { name: 'phone_confirmation', language: 'pt_BR', bodyParameters: ['Ana'], quickReplyPayloads: ['CONFIRM'] },
    };
    await transport.send(message, recipient);
    expect(bodies[0]).toMatchObject({
      type: 'template',
      template: {
        name: 'phone_confirmation',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
          { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRM' }] },
        ],
      },
    });
  });

  it('a notification\'s data cannot name one: `data.whatsappTemplate` is ignored', async () => {
    const { fetchImpl, bodies } = recordingFetch();
    const transport = whatsAppTransport({ ...declaration, fetchImpl });
    const formatted = transport.format({
      title: 'T',
      body: 'B',
      data: { whatsappTemplate: { name: 'phone_confirmation', bodyParameters: ['x'] } },
    });
    expect(formatted.template).toBeUndefined();
    await transport.send(formatted, recipient);
    expect(bodies[0]).toMatchObject({ template: { name: 'generic_alert', language: { code: 'en_US' } } });
  });

  it('body parameters are sent without newlines or tabs (Meta rejects them)', async () => {
    const { fetchImpl, bodies } = recordingFetch();
    const transport = whatsAppTransport({ ...declaration, fetchImpl });
    await transport.send(
      { ...transport.format({ title: 'T', body: 'B' }), template: { name: 'ask', bodyParameters: ['Ana\nMaria\t '] } },
      recipient,
    );
    await transport.send(transport.format({ title: 'Order\tready', body: 'line one\r\nline two' }), recipient);
    expect(bodies[0]).toMatchObject({ template: { components: [{ parameters: [{ text: 'Ana Maria' }] }] } });
    expect(bodies[1]).toMatchObject({
      template: { components: [{ parameters: [{ text: 'Order ready' }, { text: 'line one line two' }] }] },
    });
  });

  it('without one, the declaration template is sent exactly as before', async () => {
    const { fetchImpl, bodies } = recordingFetch();
    const transport = whatsAppTransport({ ...declaration, fetchImpl });
    await transport.send(transport.format({ title: 'T', body: 'B' }), recipient);
    expect(bodies[0]).toMatchObject({
      template: { name: 'generic_alert', language: { code: 'en_US' } },
    });
  });
});

describe('the consent engine asks with the host template', () => {
  it('the WhatsApp confirmation carries consent.whatsAppTemplate, built from the same input', async () => {
    const formatted: WhatsAppMessage[] = [];
    const api = mountContract(createMemoryDb(), {
      contacts: mutableContacts(),
      requireConsent: ['WHATSAPP'],
      consent: clinicConsent({
        whatsAppTemplate: (input) => ({
          name: 'phone_confirmation',
          bodyParameters: [input.firstName ?? ''],
          quickReplyPayloads: ['SIM'],
        }),
      }),
    });
    const transport: NotificationTransport<WhatsAppMessage> = {
      channel: 'WHATSAPP',
      supports: () => true,
      format: (content) => formatWhatsApp(content, declaration),
      send: (message) => {
        formatted.push(message);
        return Promise.resolve({ providerMessageId: 'wamid.ask' });
      },
    };
    api.transports.register(transport);

    expect((await consentOf(api).request('u1', 'WHATSAPP')).status).toBe('SENT');
    expect(formatted[0]?.template).toEqual({
      name: 'phone_confirmation',
      bodyParameters: ['Ana'],
      quickReplyPayloads: ['SIM'],
    });
  });
});
