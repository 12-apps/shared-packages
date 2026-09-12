import { describe, expect, it } from 'vitest';

import {
  availableChannelsOf,
  capToAvailable,
  DEFAULT_CHANNEL_ROW,
  defaultChannelMatrix,
  enabledChannelsOf,
  mergeChoices,
  mergeStoredRow,
  resolveTypeChannels,
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

/**
 * Per-TYPE channel rules (FUT-1949): availability, which is a hard cap, and
 * per-type defaults, which are not. The distinction is the whole feature, so
 * the cases that separate them are the ones worth writing down.
 */
describe('availableChannelsOf', () => {
  it('offers every channel to a type that declared nothing', () => {
    expect(availableChannelsOf(undefined)).toEqual(['EMAIL', 'SMS', 'WHATSAPP', 'WEB_PUSH']);
  });

  it('offers nothing for an EMPTY declaration, which is legal', () => {
    expect(availableChannelsOf([])).toEqual([]);
  });

  it('drops a value that is not a channel rather than carrying it', () => {
    // A typo, or a channel removed from the set since the generator was
    // written. Carrying it into an intersection would match nothing anyway;
    // dropping it here is what makes the result comparable.
    expect(availableChannelsOf(['WEB_PUSH', 'CARRIER_PIGEON' as never])).toEqual(['WEB_PUSH']);
  });

  it('fixes the order, so two spellings of one set compare equal', () => {
    expect(availableChannelsOf(['WEB_PUSH', 'EMAIL'])).toEqual(
      availableChannelsOf(['EMAIL', 'WEB_PUSH']),
    );
  });
});

describe('capToAvailable', () => {
  it('leaves the list alone when the type declared nothing', () => {
    expect(capToAvailable(['EMAIL', 'SMS'], undefined)).toEqual(['EMAIL', 'SMS']);
  });

  it('drops the channels the type does not offer', () => {
    expect(capToAvailable(['EMAIL', 'WEB_PUSH'], ['WEB_PUSH'])).toEqual(['WEB_PUSH']);
  });

  it('returns nothing for an empty declaration, whatever came in', () => {
    expect(capToAvailable(['EMAIL', 'SMS', 'WEB_PUSH'], [])).toEqual([]);
  });
});

describe('resolveTypeChannels', () => {
  const categoryDefaults = { ...DEFAULT_CHANNEL_ROW };

  it('falls back to the category defaults for a type that declared nothing', () => {
    expect(resolveTypeChannels({ categoryDefaults })).toEqual(['EMAIL', 'WEB_PUSH']);
  });

  it('drops an unavailable channel even from the defaults', () => {
    // The mesa case: `orders` defaults to e-mail, the message does not offer it.
    expect(
      resolveTypeChannels({ categoryDefaults, rules: { channels: ['WEB_PUSH'] } }),
    ).toEqual(['WEB_PUSH']);
  });

  it('DISCARDS a stored choice for a channel the type does not offer', () => {
    // The point of availability, and the one place a saved choice loses: the
    // diner ticked "e-mail" for `orders` while answering a question about
    // delivery receipts, not about the kitchen three metres away.
    expect(
      resolveTypeChannels({
        stored: { EMAIL: true, WEB_PUSH: true },
        categoryDefaults,
        rules: { channels: ['WEB_PUSH'] },
      }),
    ).toEqual(['WEB_PUSH']);
  });

  it('lets a stored choice BEAT a per-type default, which is what makes it a default', () => {
    expect(
      resolveTypeChannels({
        stored: { SMS: true },
        categoryDefaults,
        rules: { channelDefaults: { SMS: false } },
      }),
    ).toContain('SMS');
  });

  it('moves the starting point where the user has made no choice', () => {
    expect(
      resolveTypeChannels({ categoryDefaults, rules: { channelDefaults: { EMAIL: false } } }),
    ).toEqual(['WEB_PUSH']);
  });

  it('still honours a stored OFF for a channel the type does offer', () => {
    expect(
      resolveTypeChannels({
        stored: { WEB_PUSH: false },
        categoryDefaults,
        rules: { channels: ['EMAIL', 'WEB_PUSH'] },
      }),
    ).toEqual(['EMAIL']);
  });

  it('resolves to nothing for a type that offers no channel at all', () => {
    // Legal, and not an error: the router writes the inbox record regardless.
    expect(
      resolveTypeChannels({
        stored: { EMAIL: true, SMS: true, WHATSAPP: true, WEB_PUSH: true },
        categoryDefaults,
        rules: { channels: [] },
      }),
    ).toEqual([]);
  });

  it('treats a null stored row as no row rather than as every channel off', () => {
    expect(resolveTypeChannels({ stored: null, categoryDefaults })).toEqual(['EMAIL', 'WEB_PUSH']);
  });

  it('survives a stored row that is not an object', () => {
    // The column is JSON and nothing stops a bad write; a garbage row must
    // read as "no explicit choice", never throw on the emit path.
    expect(resolveTypeChannels({ stored: 'corrupted', categoryDefaults })).toEqual([
      'EMAIL',
      'WEB_PUSH',
    ]);
  });
});
