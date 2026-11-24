import { describe, expect, it } from 'vitest';

import { credentialSchemaOf } from '../../core/credential-schema';
import { allProviderAdapters } from '../catalog';
import { PT_BR_PROVIDER_COPY } from '../pt-BR';

/**
 * PagBank's token-pasting form asks for the token alone (FUT-5167).
 *
 * The other three boxes each have a working default when left blank: the card
 * key is minted from the store's own token, webhook signatures are checked
 * against that token, and Google Pay falls back to the account id. A form that
 * counted them as required never ran its connection test with the token alone,
 * so the connection stayed NÃO VERIFICADO and its switch could not be turned on.
 * Pasting a key from another account to fill the box made PagBank refuse the
 * card with 40002.
 */
function pagbankSchema() {
  const pagbank = allProviderAdapters(PT_BR_PROVIDER_COPY).find((adapter) => adapter.name === 'pagbank');
  if (!pagbank) throw new Error('pagbank is not in the catalog');
  return credentialSchemaOf(pagbank);
}

describe('pagbank credential form', () => {
  it('requires the token and nothing else', () => {
    const blocking = pagbankSchema().filter((field) => !field.optional && !field.advanced);
    expect(blocking.map((field) => field.key)).toEqual(['token']);
  });

  it('marks the three fields with a working default as optional', () => {
    const optional = pagbankSchema().filter((field) => field.optional).map((field) => field.key);
    expect(optional).toEqual(['publicKey', 'webhookToken', 'googlePayMerchantId']);
  });
});
