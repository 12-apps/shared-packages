import { describe, expect, it } from 'vitest';

import { EN_US_NOTIFICATION_UNBLOCK_COPY } from '../../../../en-US';
import { PT_BR_NOTIFICATION_UNBLOCK_COPY } from '../../../../pt-BR';
import { notificationUnblockSteps } from '../NotificationStatusNotice.helpers';

const pack = PT_BR_NOTIFICATION_UNBLOCK_COPY;

describe('notificationUnblockSteps', () => {
  it('gives every iOS browser the device-Settings steps, whatever the family', () => {
    expect(notificationUnblockSteps(pack, { family: 'chrome', platform: 'ios' })).toBe(pack.ios);
    expect(notificationUnblockSteps(pack, { family: 'safari', platform: 'ios' })).toBe(pack.ios);
  });

  it('picks the family and platform the pack names', () => {
    expect(notificationUnblockSteps(pack, { family: 'chrome', platform: 'android' })).toBe(
      pack.chrome.android,
    );
    expect(notificationUnblockSteps(pack, { family: 'firefox', platform: 'desktop' })).toBe(
      pack.firefox.desktop,
    );
  });

  it('falls back to the general steps for a platform the family has no list for', () => {
    // Samsung Internet only ships on Android; Safari only on Apple devices.
    expect(notificationUnblockSteps(pack, { family: 'samsung', platform: 'desktop' })).toBe(
      pack.other,
    );
    expect(notificationUnblockSteps(pack, { family: 'safari', platform: 'android' })).toBe(
      pack.other,
    );
  });

  it('falls back to the general steps for an unrecognised browser', () => {
    expect(notificationUnblockSteps(pack, { family: 'other', platform: 'desktop' })).toBe(
      pack.other,
    );
  });

  it('has the same number of steps in every language, list by list', () => {
    const shape = (copy: typeof pack) =>
      JSON.stringify(copy, (_key, value: unknown) =>
        Array.isArray(value) ? value.length : value,
      );
    expect(shape(EN_US_NOTIFICATION_UNBLOCK_COPY)).toBe(shape(pack));
  });
});
