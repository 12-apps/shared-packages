import { describe, expect, it, vi } from 'vitest';

import type { OAuthAppCredentialsResolver } from '../config/oauth';
import { oauthAppWebhookSecret } from '../config/oauth-env';
import { createWebhookLog } from '../core/webhook-log';

const ARRIVAL = { tenantSlug: 'platform-homologacao', provider: 'pagbank', bytes: 15 };

function logger() {
  return { info: vi.fn<(message: string) => void>(), warn: vi.fn<(message: string) => void>() };
}

describe('createWebhookLog', () => {
  it('writes arrival and acceptance at info, a refusal and an unknown store at warn', () => {
    const log = logger();
    const lines = createWebhookLog(log);

    lines.logWebhookArrival(ARRIVAL);
    lines.logWebhookAccepted(ARRIVAL, 200);
    lines.logWebhookRefused(ARRIVAL, 'WebhookVerificationError');
    lines.logWebhookUnknownTenant('ghost', 'pagbank');

    expect(log.info.mock.calls.map(([line]) => line)).toEqual([
      'payments.webhook received: pagbank for platform-homologacao (15 bytes)',
      'payments.webhook accepted: pagbank for platform-homologacao → 200',
    ]);
    expect(log.warn.mock.calls.map(([line]) => line)).toEqual([
      'payments.webhook refused: pagbank for platform-homologacao — WebhookVerificationError',
      'payments.webhook refused: pagbank for unknown store "ghost"',
    ]);
  });

  it('names the signing field once per provider and field, and nothing when none is known (FUT-678)', () => {
    const log = logger();
    const { observer } = createWebhookLog(log);

    observer.accepted('pagbank', 1, 'platformWebhookSecret');
    observer.accepted('pagbank', 1, 'platformWebhookSecret');
    observer.accepted('pagbank', 1, 'token');
    observer.accepted('stripe', 1, null);
    observer.accepted('stripe', 1);

    expect(log.warn.mock.calls.map(([line]) => line)).toEqual([
      'payments.webhook signer: pagbank deliveries verify under platformWebhookSecret',
      'payments.webhook signer: pagbank deliveries verify under token',
    ]);
  });
});

describe('oauthAppWebhookSecret', () => {
  const app: OAuthAppCredentialsResolver = (provider, environment) => {
    const fields: Record<string, string> =
      provider === 'pagbank'
        ? { clientId: 'c', clientSecret: 's', accountToken: `acct-${environment}` }
        : { clientId: 'c', clientSecret: 's', webhookSecret: 'whsec', accountToken: 'acct' };
    return { environment, fields };
  };
  const merchant = { kind: 'TENANT', id: 't' } as const;

  it('answers each environment with its own account token, for the providers named only', async () => {
    const resolve = oauthAppWebhookSecret(app, ['pagbank']);

    await expect(resolve(merchant, 'pagbank', 'SANDBOX')).resolves.toBe('acct-SANDBOX');
    await expect(resolve(merchant, 'pagbank', 'PRODUCTION')).resolves.toBe('acct-PRODUCTION');
    await expect(resolve(merchant, 'stripe', 'PRODUCTION')).resolves.toBeNull();
  });

  it('prefers an endpoint webhookSecret over the account token, and is null with no application', async () => {
    await expect(oauthAppWebhookSecret(app, ['stripe'])(merchant, 'stripe', 'PRODUCTION')).resolves.toBe('whsec');
    await expect(oauthAppWebhookSecret(() => null, ['pagbank'])(merchant, 'pagbank', 'SANDBOX')).resolves.toBeNull();
  });
});
