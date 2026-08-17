import { describe, expect, it, vi } from 'vitest';

import { isValidCpf } from '../core/cpf';
import { forgetVaultPointers, type VaultPointerRef } from '../core/gateway-vault';
import { ProviderRequestError, UnsupportedOperationError } from '../core/errors';
import { createConnectState, parseEnvironment } from '../config/connect-state';
import type { MerchantRef } from '../core/types';

const ACME: MerchantRef = { kind: 'PLATFORM', id: 'platform' };

describe('isValidCpf', () => {
  it('accepts a CPF whose two check digits verify', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('rejects wrong length, bad digits and all-same-digit sequences', () => {
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });
});

describe('createConnectState', () => {
  const connect = createConnectState({
    cookiePrefix: 'host_pay_oauth',
    callbackPath: '/api/payments/oauth/callback',
    baseUrl: () => 'https://store.example',
  });

  it('mints a state the consume check accepts, with merchant and environment recovered', () => {
    const minted = connect.mint('acme', 'pagbank', 'PRODUCTION');
    expect(minted.redirectUri).toBe('https://store.example/api/payments/oauth/callback/pagbank');
    expect(minted.cookie.name).toBe('host_pay_oauth_pagbank');
    expect(minted.cookie.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/payments/oauth/callback',
      maxAge: 600,
    });
    expect(connect.consume(minted.cookie.value, minted.state)).toEqual({
      environment: 'PRODUCTION',
      tenantSlug: 'acme',
    });
  });

  it('refuses a mismatched or absent state, and a cookie naming no merchant', () => {
    const minted = connect.mint('acme', 'pagbank', 'SANDBOX');
    expect(connect.consume(minted.cookie.value, 'not-the-state')).toBeNull();
    expect(connect.consume(minted.cookie.value, null)).toBeNull();
    expect(connect.consume(undefined, minted.state)).toBeNull();
  });

  it('parses the cookie from the ends so a dotted slug cannot shift the fields', () => {
    const minted = connect.mint('acme.v2', 'stripe', 'SANDBOX');
    expect(connect.consume(minted.cookie.value, minted.state)).toEqual({
      environment: 'SANDBOX',
      tenantSlug: 'acme.v2',
    });
    expect(connect.peekTenant(minted.cookie.value)).toBe('acme.v2');
  });

  it('derives an insecure cookie for a plain-http origin', () => {
    const dev = createConnectState({
      cookiePrefix: 'host_pay_oauth',
      callbackPath: '/cb',
      baseUrl: () => 'http://localhost:3000',
    });
    expect(dev.mint('acme', 'pagbank', 'SANDBOX').cookie.options.secure).toBe(false);
  });

  it('fails to SANDBOX for anything but an explicit PRODUCTION', () => {
    expect(parseEnvironment('PRODUCTION')).toBe('PRODUCTION');
    expect(parseEnvironment('production')).toBe('SANDBOX');
    expect(parseEnvironment(null)).toBe('SANDBOX');
    expect(parseEnvironment(undefined)).toBe('SANDBOX');
  });
});

describe('forgetVaultPointers', () => {
  const pointers: VaultPointerRef[] = [
    { provider: 'stripe', instrumentId: 'pm_1', customerRef: 'cus_1' },
    { provider: 'pagbank', instrumentId: 'card_2' },
  ];

  it('detaches provider-first and drops each pointer after', async () => {
    const forgetVault = vi.fn().mockResolvedValue(undefined);
    const dropped: string[] = [];
    const result = await forgetVaultPointers({ forgetVault }, ACME, pointers, async (p) => {
      dropped.push(p.instrumentId);
    });
    expect(result).toEqual({ ok: true });
    expect(forgetVault).toHaveBeenCalledWith(ACME, 'stripe', {
      instrumentId: 'pm_1',
      customerRef: 'cus_1',
    });
    expect(dropped).toEqual(['pm_1', 'card_2']);
  });

  it('drops the pointer anyway on a PERMANENT provider refusal and keeps going', async () => {
    const forgetVault = vi
      .fn()
      .mockRejectedValueOnce(new UnsupportedOperationError('stripe', 'forgetting a saved card'))
      .mockResolvedValueOnce(undefined);
    const dropped: string[] = [];
    const result = await forgetVaultPointers({ forgetVault }, ACME, pointers, async (p) => {
      dropped.push(p.instrumentId);
    });
    expect(result).toEqual({ ok: true });
    expect(dropped).toEqual(['pm_1', 'card_2']);
  });

  it('stops with ok:false on a retriable failure, keeping the pointer', async () => {
    const forgetVault = vi
      .fn()
      .mockRejectedValue(new ProviderRequestError('stripe', 'unavailable', { httpStatus: 503, retriable: true }));
    const dropped: string[] = [];
    const result = await forgetVaultPointers({ forgetVault }, ACME, pointers, async (p) => {
      dropped.push(p.instrumentId);
    });
    expect(result).toEqual({ ok: false });
    expect(dropped).toEqual([]);
    expect(forgetVault).toHaveBeenCalledTimes(1);
  });

  it('a fault on OUR side of the seam never deletes a payment record', async () => {
    const forgetVault = vi.fn().mockRejectedValue(new TypeError('boom'));
    const dropped: string[] = [];
    const result = await forgetVaultPointers({ forgetVault }, ACME, pointers, async (p) => {
      dropped.push(p.instrumentId);
    });
    expect(result).toEqual({ ok: false });
    expect(dropped).toEqual([]);
  });
});
