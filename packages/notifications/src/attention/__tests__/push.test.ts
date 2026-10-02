import { describe, expect, it } from 'vitest';

import { ATTENTION_DATA_KEY, attentionSeverityOf, wantsAttentionPush } from '../push';

describe('an attention push and the devices that take it', () => {
  it('reads the severity a notification declares, and nothing else', () => {
    expect(attentionSeverityOf({ attention: 'late' })).toBe('late');
    expect(attentionSeverityOf({ attention: 'loud' })).toBeNull();
    expect(attentionSeverityOf({})).toBeNull();
    expect(attentionSeverityOf(undefined)).toBeNull();
    expect(attentionSeverityOf({ attention: 5 })).toBeNull();
    expect(attentionSeverityOf({ attention: null })).toBeNull();
    expect(attentionSeverityOf({ attention: { severity: 'late' } })).toBeNull();
    expect(ATTENTION_DATA_KEY).toBe('attention');
  });

  it("follows the device's level, and lets a device that never chose take everything", () => {
    expect(wantsAttentionPush('off', 'spent')).toBe(false);
    expect(wantsAttentionPush('late', 'calm')).toBe(false);
    expect(wantsAttentionPush('late', 'late')).toBe(true);
    expect(wantsAttentionPush('all', 'calm')).toBe(true);
    expect(wantsAttentionPush(null, 'calm')).toBe(true);
    expect(wantsAttentionPush(undefined, 'calm')).toBe(true);
    expect(wantsAttentionPush('loud', 'calm')).toBe(true);
    // Not attention: every device, whatever its level.
    expect(wantsAttentionPush('off', null)).toBe(true);
  });
});
