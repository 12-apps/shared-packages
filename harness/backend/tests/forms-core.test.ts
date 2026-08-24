/**
 * `@12-apps/forms-core` from a CONSUMER — the one package in the estate with no
 * harness coverage at all until now.
 *
 * It is pure (zero dependencies, no I/O), which is exactly why it was skipped
 * and exactly why the gap mattered: a package whose own suite passes is still
 * one `files` entry away from shipping an empty tarball, and that failure is
 * invisible to every test that imports a sibling from inside the workspace.
 * `@12-apps/typescript-config` shipped an EMPTY tarball for three releases, and
 * this is the arrangement that would have caught it on the first.
 *
 * So what these cases assert is deliberately not a re-run of the package's own
 * unit tests. It is what only a consumer can see:
 *
 * - the ROOT entry resolves and carries all four barrels (validators, the
 *   `Result` type, the server-action wrapper, the Brazilian helpers) — a
 *   subpath that stopped being exported fails here as a missing import rather
 *   than as a type error inside the package;
 * - the pieces compose the way an adopter composes them, which is the only
 *   claim about the package a host actually depends on.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  ActionError,
  createServerAction,
  email,
  err,
  formatCep,
  formatCnpj,
  isUf,
  isValidCep,
  isValidCnpj,
  minLength,
  ok,
  required,
  validateFields,
  type Result,
} from '@12-apps/forms-core';

describe('the published entry point', () => {
  it('carries all four barrels off the root', () => {
    // Named one by one rather than counted: the failure this guards against is
    // a subpath quietly leaving `exports`, and a count passes while the wrong
    // half is missing.
    expect(typeof required).toBe('function');
    expect(typeof validateFields).toBe('function');
    expect(typeof ok).toBe('function');
    expect(typeof createServerAction).toBe('function');
    expect(typeof isValidCnpj).toBe('function');
  });
});

describe('the validators, as a host composes them', () => {
  it('reports the FIRST failing rule per field, in the host words', () => {
    const errors = validateFields(
      { name: '', contact: 'not-an-address' },
      {
        name: [required('Informe o nome.')],
        contact: [required('Informe o e-mail.'), email('E-mail inválido.')],
      },
    );

    expect(errors).toEqual({ name: 'Informe o nome.', contact: 'E-mail inválido.' });
  });

  it('says nothing about a field that passes', () => {
    expect(validateFields({ name: 'Ana' }, { name: [required('x'), minLength(2, 'y')] })).toEqual(
      {},
    );
  });
});

describe('createServerAction — the shape a form reads', () => {
  const action = createServerAction(
    { name: [required('Informe o nome.')] },
    async (input: { name: string }) => ({ id: `p-${input.name}` }),
  );

  it('runs the handler only for input that validated', async () => {
    await expect(action({ name: 'lanterna' })).resolves.toEqual(ok({ id: 'p-lanterna' }));
  });

  it('attributes a refusal to the field that caused it', async () => {
    const outcome = (await action({ name: '' })) as Result<never>;

    expect(outcome).toEqual(err('Informe o nome.', { name: 'Informe o nome.' }));
  });

  it('surfaces an ActionError verbatim — that is what it is for', async () => {
    const conflicting = createServerAction({ name: [] }, () => {
      throw new ActionError('Já existe um produto com esse nome.', 'name');
    });

    expect(await conflicting({ name: 'lanterna' })).toEqual(
      err('Já existe um produto com esse nome.', { name: 'Já existe um produto com esse nome.' }),
    );
  });

  it('collapses an UNEXPECTED throw into a generic message', async () => {
    // The security property of the wrapper: an internal failure must not reach
    // the browser as its own message. The real cause goes to the server log,
    // which is the half a consumer can check and the package's own suite
    // asserts nothing about from outside.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = createServerAction({ name: [] }, () => {
      throw new Error('connection to db-7 refused');
    });

    const outcome = (await broken({ name: 'lanterna' })) as { ok: false; error: string };

    expect(outcome.ok).toBe(false);
    expect(outcome.error).not.toContain('db-7');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('the Brazilian helpers', () => {
  it('validates a CNPJ by its check digits, not by its shape', () => {
    // A well-formed string with the wrong digits is the case a regex passes and
    // a customer's invoice fails on.
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
  });

  it('formats what a person typed into what a form displays', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCep('01310930')).toBe('01310-930');
    expect(isValidCep('01310-930')).toBe(true);
  });

  it('knows the states, and refuses what is not one', () => {
    expect(isUf('SP')).toBe(true);
    expect(isUf('XX')).toBe(false);
  });
});
