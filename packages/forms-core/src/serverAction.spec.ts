import { describe, expect, it, vi } from 'vitest';

import {
  ActionError,
  createServerAction,
  email,
  err,
  ok,
  required,
} from './index';

describe('forms-core/result', () => {
  describe('ok', () => {
    it('returns the success shape wrapping the data', () => {
      expect(ok(42)).toEqual({ ok: true, data: 42 });
    });
  });

  describe('err', () => {
    it('returns the error shape wrapping the message', () => {
      expect(err('bad')).toEqual({ ok: false, error: 'bad' });
    });

    it('includes fieldErrors when provided', () => {
      expect(err('bad name', { name: 'bad name' })).toEqual({
        ok: false,
        error: 'bad name',
        fieldErrors: { name: 'bad name' },
      });
    });
  });
});

describe('forms-core/createServerAction', () => {
  const schema = { email: [required(), email()] };

  it('returns ok and calls the handler exactly once on valid input', async () => {
    const handler = vi.fn(async (input: { email: string }) => input.email);
    const action = createServerAction(schema, handler);

    const result = await action({ email: 'a@b.com' });

    expect(result).toEqual({ ok: true, data: 'a@b.com' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns err and never calls the handler on invalid input', async () => {
    const handler = vi.fn(async (input: { email: string }) => input.email);
    const action = createServerAction(schema, handler);

    const result = await action({ email: '' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error).toBeTruthy();
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('maps a throwing handler to a generic err with no stack trace leak', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secret = 'INTERNAL_STACK_DETAIL';
    const handler = vi.fn(async () => {
      throw new Error(secret);
    });
    const action = createServerAction(schema, handler);

    const result = await action({ email: 'a@b.com' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain(secret);
      expect(result.error).not.toContain('at ');
    }
    // The real cause is logged server-side for diagnosis, never returned.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('passes through the message of a thrown ActionError verbatim', async () => {
    const handler = vi.fn(async () => {
      throw new ActionError('A product with this name already exists.');
    });
    const action = createServerAction(schema, handler);

    const result = await action({ email: 'a@b.com' });

    expect(result).toEqual({
      ok: false,
      error: 'A product with this name already exists.',
    });
  });

  it('attributes a validation failure to the offending field', async () => {
    const handler = vi.fn(async (input: { email: string }) => input.email);
    const action = createServerAction(schema, handler);

    const result = await action({ email: '' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors).toEqual({ email: result.error });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('surfaces an ActionError field as fieldErrors so the form can highlight it', async () => {
    const handler = vi.fn(async () => {
      throw new ActionError('Já existe um produto com esse nome.', 'name');
    });
    const action = createServerAction(schema, handler);

    const result = await action({ email: 'a@b.com' });

    expect(result).toEqual({
      ok: false,
      error: 'Já existe um produto com esse nome.',
      fieldErrors: { name: 'Já existe um produto com esse nome.' },
    });
  });

  it('passes an ActionError fieldErrors map straight through (multi-field)', async () => {
    const fieldErrors = { 'sku:ABC': 'ABC já usado', 'sku:XYZ': 'XYZ já usado' };
    const handler = vi.fn(async () => {
      throw new ActionError('SKUs duplicados.', undefined, fieldErrors);
    });
    const action = createServerAction(schema, handler);

    const result = await action({ email: 'a@b.com' });

    expect(result).toEqual({ ok: false, error: 'SKUs duplicados.', fieldErrors });
  });
});
