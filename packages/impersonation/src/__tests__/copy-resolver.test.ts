import { describe, expect, it } from 'vitest';

import { createPathRules } from '../core/paths';
import type { ImpersonationState } from '../core/types';
import { messagesOf, type ImpersonationMessages } from '../server/context';
import { createImpersonationGuard, ImpersonationRefusedError } from '../server/write-guard';

import { TEST_MESSAGES, testServerConfig } from './fixtures';

/**
 * The copy seam: `messages` takes a pack OR a resolver, and every reader below
 * it resolves at the moment a sentence is needed.
 *
 * This package ships NO packs, deliberately — its own portability suite
 * asserts that, and the reasoning stands: a refusal's wording is the host's
 * domain vocabulary. What was missing was not words, it was the ABILITY for a
 * host that has two languages to hand both over. That is what is pinned here.
 */

const { paths } = testServerConfig();

/** A second language, distinguishable from `TEST_MESSAGES` in every field. */
const OTHER: ImpersonationMessages = Object.fromEntries(
  Object.entries(TEST_MESSAGES).map(([key, value]) => [key, `[other] ${value}`]),
) as ImpersonationMessages;

const pickByLocale = ({ locale }: { readonly locale?: string | null }) =>
  locale === 'en-US' ? OTHER : TEST_MESSAGES;

function state(): ImpersonationState {
  return {
    kind: 'operator',
    realUserId: 'operator-1',
    subjectUserId: 'subject-1',
    tenantId: 'tenant-1',
    targetApp: 'admin',
    reason: 'looking into a support ticket that is long enough',
    allowWrites: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe('messagesOf', () => {
  it('passes a plain pack straight through', () => {
    expect(messagesOf({ messages: TEST_MESSAGES })).toBe(TEST_MESSAGES);
    expect(messagesOf({ messages: TEST_MESSAGES }, 'en-US')).toBe(TEST_MESSAGES);
  });

  it('asks a resolver for the locale it was given', () => {
    expect(messagesOf({ messages: pickByLocale }, 'en-US')).toBe(OTHER);
    expect(messagesOf({ messages: pickByLocale }, 'pt-BR')).toBe(TEST_MESSAGES);
  });

  it('treats an absent locale as "nobody said" rather than a default', () => {
    // The resolver decides, in one place. This module must not invent one.
    const seen: Array<string | null | undefined> = [];
    messagesOf({
      messages: ({ locale }) => {
        seen.push(locale);
        return TEST_MESSAGES;
      },
    });

    expect(seen).toEqual([undefined]);
  });
});

describe('the write guard, given a resolver', () => {
  /**
   * Rule B where it would actually go wrong.
   *
   * `createImpersonationGuard` runs ONCE at the host's mount and then refuses
   * every write for the life of the process. Resolve the pack on the way in
   * and every operator is refused in whichever language the process started
   * with — which a single-locale host cannot tell from correct. ONE guard, two
   * callers, two languages is the assertion that says otherwise.
   */
  const guard = createImpersonationGuard({
    rules: createPathRules(paths),
    messages: pickByLocale,
  });

  const refuse = async (locale?: string): Promise<ImpersonationRefusedError> =>
    (await guard
      .assertAllowed({
        impersonation: state(),
        pathname: '/api/tenants/tenant-1/settings',
        method: 'POST',
        locale,
      })
      .catch((caught: unknown) => caught)) as ImpersonationRefusedError;

  it('refuses two callers in their own languages from ONE guard', async () => {
    const [pt, en] = await Promise.all([refuse('pt-BR'), refuse('en-US')]);

    expect(pt).toBeInstanceOf(ImpersonationRefusedError);
    expect(en).toBeInstanceOf(ImpersonationRefusedError);
    expect(pt.message).toBe(TEST_MESSAGES.readOnly);
    expect(en.message).toBe(OTHER.readOnly);
  });

  it('keeps the refusal CODE fixed while its sentence follows the reader', async () => {
    /**
     * Rule H, on the half that must never move. A client branches on the code
     * to decide whether to show an upgrade prompt or point at settings; a code
     * that followed the reader would make that branch language-dependent.
     */
    const [pt, en] = await Promise.all([refuse('pt-BR'), refuse('en-US')]);

    expect(en.refusal).toBe(pt.refusal);
    expect(en.message).not.toBe(pt.message);
  });

  it('still takes a plain pack, so a single-audience host changes nothing', async () => {
    const plain = createImpersonationGuard({
      rules: createPathRules(paths),
      messages: TEST_MESSAGES,
    });
    const error = (await plain
      .assertAllowed({
        impersonation: state(),
        pathname: '/api/tenants/tenant-1/settings',
        method: 'POST',
        locale: 'en-US',
      })
      .catch((caught: unknown) => caught)) as ImpersonationRefusedError;

    expect(error.message).toBe(TEST_MESSAGES.readOnly);
  });
});
