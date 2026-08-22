import { describe, expect, it } from 'vitest';

import { pagbankConnectError } from '../providers/pagbank-connect-errors';

/**
 * These codes arrived as bare numbers on an HTTP status, and one of them cost
 * days: `41008` means the **Bearer** header is wrong — the platform's account
 * token — while reading exactly like "your client credentials are bad". The
 * investigation it triggered audited a `client_id`/`client_secret` pair that
 * were correct throughout.
 */
describe('pagbankConnectError', () => {
  /** The expensive one. */
  it('names 41008 as the Authorization header, not the client credentials', () => {
    const named = pagbankConnectError('PagBank OAuth 401 Unauthorized: 41008 invalid_token');

    expect(named).toContain('invalid_token');
    expect(named).toMatch(/Bearer/i);
    // The whole point: it must steer AWAY from the credentials that are fine.
    // The gloss is English now (FUT-760 — a developer reads this, in a log),
    // so the phrase moved; what it has to say did not.
    expect(named).toMatch(/PLATFORM ACCOUNT TOKEN/);
  });

  /**
   * The code whose plain meaning was misread as "PagBank cannot refresh". Its
   * definition says the opposite, so the explanation points at the endpoint.
   */
  it('sends 41005 to the endpoint rather than the grant type', () => {
    expect(pagbankConnectError('400 Bad Request: 41005 unsupported_grant_type')).toMatch(
      /\/oauth2\/refresh/,
    );
  });

  /** Not about our request at all — about the URL registered for our client. */
  it.each(['41013', '41014', '41015', '41016'])('explains %s as the public-key URL', (code) => {
    expect(pagbankConnectError(`401: ${code} something`)).toMatch(/URL|public key/i);
  });

  it('covers every documented code', () => {
    const documented = [
      '41001', '41002', '41003', '41004', '41005', '41006', '41007',
      '41008', '41012', '41013', '41014', '41015', '41016',
    ];
    for (const code of documented) {
      expect(pagbankConnectError(`error ${code} here`), code).not.toBeNull();
    }
  });

  /** Silent rather than guessing — an unknown code is not translated. */
  it('says nothing about a code PagBank does not document', () => {
    expect(pagbankConnectError('500: 41099 mystery')).toBeNull();
    expect(pagbankConnectError('PagBank 403 Forbidden: ACCESS_DENIED')).toBeNull();
  });

  /**
   * Standalone-token matching: a code embedded in a longer identifier is not a
   * Connect error, and translating it would put a confident wrong explanation
   * in front of whoever is debugging.
   */
  it('does not match a code buried inside an identifier', () => {
    expect(pagbankConnectError('order ORDE_9941008x request failed')).toBeNull();
  });
});
