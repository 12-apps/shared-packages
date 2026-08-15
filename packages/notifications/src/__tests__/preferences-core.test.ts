import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CHANNEL_ROW,
  defaultChannelMatrix,
  enabledChannelsOf,
  mergeChoices,
  mergeStoredRow,
} from '../preferences-core';

/**
 * The preference POLICY, with no storage in it — the half a browser also runs.
 */
describe('the default matrix', () => {
  it('turns the free channels on and the paid per-message ones off', () => {
    expect(DEFAULT_CHANNEL_ROW).toEqual({
      EMAIL: true,
      SMS: false,
      WHATSAPP: false,
      WEB_PUSH: true,
    });
  });

  it('covers every category of the taxonomy it is given', () => {
    // A host's own categories, supplied here as one would supply them.
    const matrix = defaultChannelMatrix(['orders', 'payments', 'stock', 'system']);
    expect(Object.keys(matrix).sort()).toEqual(['orders', 'payments', 'stock', 'system']);
    expect(matrix.orders).toEqual(DEFAULT_CHANNEL_ROW);
  });

  it('covers a HOST taxonomy, which is the point of taking one', () => {
    const matrix = defaultChannelMatrix(['deliveries', 'invoices']);
    expect(Object.keys(matrix)).toEqual(['deliveries', 'invoices']);
  });

  it('gives each category its own row object, so one toggle is not four', () => {
    const matrix = defaultChannelMatrix(['a', 'b']);
    matrix.a!.EMAIL = false;
    expect(matrix.b!.EMAIL).toBe(true);
  });

  it('honours a host that disagrees with the defaults', () => {
    const matrix = defaultChannelMatrix(['orders'], { SMS: true, WEB_PUSH: false });
    expect(matrix.orders).toEqual({
      EMAIL: true,
      SMS: true,
      WHATSAPP: false,
      WEB_PUSH: false,
    });
  });
});

describe('coercing a stored row', () => {
  it('keeps the stored booleans and fills the gaps from the base', () => {
    expect(mergeStoredRow({ EMAIL: false, SMS: true }, DEFAULT_CHANNEL_ROW)).toEqual({
      EMAIL: false,
      SMS: true,
      WHATSAPP: false,
      WEB_PUSH: true,
    });
  });

  it('is the reason a NEW channel needs no data migration', () => {
    // A row written before WEB_PUSH existed carries no key for it, and must not
    // read as "the user turned it off".
    expect(mergeStoredRow({ EMAIL: true, SMS: false }, DEFAULT_CHANNEL_ROW).WEB_PUSH).toBe(true);
  });

  it('ignores non-boolean and unknown keys rather than trusting them', () => {
    const row = mergeStoredRow(
      { EMAIL: 'yes', SMS: 1, TELEGRAM: true, WHATSAPP: true },
      DEFAULT_CHANNEL_ROW,
    );
    expect(row).toEqual({ EMAIL: true, SMS: false, WHATSAPP: true, WEB_PUSH: true });
    expect('TELEGRAM' in row).toBe(false);
  });

  it('treats null / a string / an array as no stored choices at all', () => {
    for (const stored of [null, undefined, 'EMAIL', 42]) {
      expect(mergeStoredRow(stored, DEFAULT_CHANNEL_ROW)).toEqual(DEFAULT_CHANNEL_ROW);
    }
  });
});

describe('the router gate and the save merge', () => {
  it('lists the enabled channels in the canonical channel order', () => {
    expect(
      enabledChannelsOf({ SMS: true, EMAIL: true, WEB_PUSH: false, WHATSAPP: true }),
    ).toEqual(['EMAIL', 'SMS', 'WHATSAPP']);
  });

  it('merges a single toggle over the CURRENT row, never over the defaults', () => {
    // The failure this prevents: the settings UI writes one toggle at a time, so
    // a whole-row write would resurrect a channel the user had switched off.
    const current = { EMAIL: false, SMS: false, WHATSAPP: false, WEB_PUSH: true };
    expect(mergeChoices(current, { SMS: true })).toEqual({
      EMAIL: false,
      SMS: true,
      WHATSAPP: false,
      WEB_PUSH: true,
    });
  });
});
