import { describe, expect, it } from 'vitest';

import { createPaymentsSettingsClient, PaymentsClientError } from '../client';
import { describeFailure } from '../components/failure-copy';
import { EN_US_PAYMENTS_SETTINGS_COPY } from '../components/settings-en-US';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/** A gateway that refuses every call with this body. */
const refusing = (status: number, body: string) =>
  createPaymentsSettingsClient({
    baseUrl: '/api/payments',
    fetchImpl: async () => new Response(body, { status }),
  });

const failures = PT_BR_PAYMENTS_SETTINGS_COPY.failures!;

// The settings red alert used to show the gateway's `message`,
// developer English ("Provider stripe is not connected"), as the whole text.
describe('a gateway refusal on the settings screen', () => {
  it("reads as the host's sentence for its code, never the server's message", async () => {
    const client = refusing(
      400,
      JSON.stringify({ error: 'CredentialsError', message: 'Provider stripe is not connected' }),
    );
    const error = await client.getSettings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentsClientError);
    expect((error as PaymentsClientError).code).toBe('CredentialsError');
    expect(describeFailure(error, failures)).toBe(failures.byCode.CredentialsError);
    expect(describeFailure(error, failures)).not.toContain('Provider');
  });

  it('falls back to the generic sentence with the status, for a code the copy does not name', async () => {
    const error = await refusing(502, '').getSettings().catch((e: unknown) => e);
    expect(describeFailure(error, failures)).toBe(
      'Não foi possível concluir a operação (502). Tente novamente.',
    );
  });

  it('names a failure that never reached the gateway without a status', () => {
    expect(describeFailure(new TypeError('Failed to fetch'), failures)).toContain('conexão');
  });

  it('ships a sentence for every code in both packs', () => {
    const en = Object.keys(EN_US_PAYMENTS_SETTINGS_COPY.failures!.byCode).sort();
    expect(Object.keys(failures.byCode).sort()).toEqual(en);
  });
});
