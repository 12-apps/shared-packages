import { describe, expect, it } from 'vitest';

import { email, min, minLength, required, validateFields } from './validators';

describe('forms/validators', () => {
  describe('required', () => {
    it('returns an error message for an empty string', () => {
      const result = required()('');
      expect(typeof result).toBe('string');
      expect(result).toBeTruthy();
    });

    it('returns undefined for a non-empty value', () => {
      expect(required()('hello')).toBeUndefined();
    });

    it('supports a custom message', () => {
      expect(required('Campo obrigatório')('')).toBe('Campo obrigatório');
    });
  });

  describe('email', () => {
    it('returns an error message for a malformed address', () => {
      const result = email()('not-an-email');
      expect(typeof result).toBe('string');
      expect(result).toBeTruthy();
    });

    it('returns undefined for a valid address', () => {
      expect(email()('a@b.com')).toBeUndefined();
    });

    it('supports a custom message', () => {
      expect(email('E-mail inválido')('bad')).toBe('E-mail inválido');
    });
  });

  describe('minLength / min', () => {
    it('returns an error message when the value is shorter than the minimum', () => {
      const result = minLength(3)('ab');
      expect(typeof result).toBe('string');
      expect(result).toBeTruthy();
    });

    it('returns undefined when the value meets the minimum length', () => {
      expect(minLength(3)('abc')).toBeUndefined();
    });

    it('exposes min as an alias of minLength', () => {
      expect(min).toBe(minLength);
      expect(min(3)('ab')).toBeTruthy();
      expect(min(3)('abc')).toBeUndefined();
    });

    it('supports a custom message', () => {
      expect(minLength(3, 'Muito curto')('ab')).toBe('Muito curto');
    });
  });

  describe('validateFields', () => {
    it('returns an entry per failing field using the first failing validator', () => {
      const requiredMsg = required()('') as string;
      const errors = validateFields(
        { email: '' },
        { email: [required(), email()] },
      );
      expect(errors).toEqual({ email: requiredMsg });
    });

    it('returns an empty object when all fields are valid', () => {
      const errors = validateFields(
        { email: 'a@b.com' },
        { email: [required(), email()] },
      );
      expect(errors).toEqual({});
    });
  });
});
