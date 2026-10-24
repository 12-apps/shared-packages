import { describe, expect, it } from 'vitest';

import { DEFAULT_MESSAGES } from '../../server/config';
import { PT_BR_AUDIT_MESSAGES } from '../../server/pt-BR';
import { createAuditLabels, DEFAULT_LABELS } from '../labels';
import { PT_BR_AUDIT_LABELS } from '../pt-BR';

// The trail shipped English defaults and no pt-BR pack, so a pt-BR
// host had to translate all thirty strings itself or show English.
describe('the pt-BR audit pack', () => {
  it('translates every label the surface renders, and assembles', () => {
    expect(Object.keys(PT_BR_AUDIT_LABELS).sort()).toEqual(Object.keys(DEFAULT_LABELS).sort());
    expect(createAuditLabels(PT_BR_AUDIT_LABELS).title).toBe('Trilha de auditoria');
  });

  it('translates every API message', () => {
    expect(Object.keys(PT_BR_AUDIT_MESSAGES).sort()).toEqual(Object.keys(DEFAULT_MESSAGES).sort());
    for (const [key, value] of Object.entries(PT_BR_AUDIT_MESSAGES)) {
      expect(value, key).not.toBe(DEFAULT_MESSAGES[key as keyof typeof DEFAULT_MESSAGES]);
    }
  });

  it('leaves no sentence in English', () => {
    const neutral = new Set(['exportCsv', 'exportJson']);
    for (const [key, value] of Object.entries(PT_BR_AUDIT_LABELS)) {
      if (neutral.has(key)) continue;
      expect(value, key).not.toBe(DEFAULT_LABELS[key as keyof typeof DEFAULT_LABELS]);
    }
  });
});
