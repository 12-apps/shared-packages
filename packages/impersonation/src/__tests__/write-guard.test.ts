import { describe, expect, it, vi } from 'vitest';

import { createPathRules } from '../core/paths';
import type { ImpersonationState } from '../core/types';
import {
  impersonationPermitsWrites,
  outsideBoundedTenant,
  previewCeilingKind,
} from '../core/write-rules';
import type {
  PreviewEntitlementPort,
} from '../server/ports';
import {
  createImpersonationGuard,
  ImpersonationRefusedError,
} from '../server/write-guard';

import { TEST_MESSAGES, testServerConfig } from './fixtures';

/**
 * The write gate — the branch order, the two surfaces that outrank the per-kind
 * rule, and the live revocation that refuses READS.
 *
 * The toy host's URL layout is the one in `fixtures.ts`: money under
 * `/api/basket` and `/api/checkout`, a tenant's bill under
 * `/api/tenants/:id/billing`, personal account under `/api/me`, and this
 * package's own mounts at `/api/session-preview` and
 * `/api/tenants/:slug/session-preview`.
 */

const { paths } = testServerConfig();

/** A fixed clock: nothing in this suite depends on the wall clock moving. */
const NOW = Date.parse('2026-05-01T12:00:00.000Z');

function guard(options: { previewEntitlement?: PreviewEntitlementPort; onError?: () => void } = {}) {
  return createImpersonationGuard({
    rules: createPathRules(paths),
    messages: TEST_MESSAGES,
    previewEntitlement: options.previewEntitlement,
    onError: options.onError,
  });
}

function state(overrides: Partial<ImpersonationState> = {}): ImpersonationState {
  return {
    kind: 'operator',
    tenantId: 't-1',
    subjectUserId: 'u-target',
    realUserId: 'u-actor',
    allowWrites: false,
    previewRoleName: null,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

const verdict = (
  impersonation: ImpersonationState | null,
  pathname: string,
  method: string,
) => guard().refusalFor({ impersonation, pathname, method });

describe('no impersonation, no opinion', () => {
  it('allows everything when nothing is in force', async () => {
    await expect(verdict(null, '/api/checkout/pay', 'POST')).resolves.toBeNull();
  });
});

describe('the request METHOD is the read/write signal', () => {
  it('treats a verb the host does not serve as a write — deny is the default branch', async () => {
    await expect(verdict(state(), '/api/widgets/1', 'PURGE')).resolves.toBe(
      'IMPERSONATION_READ_ONLY',
    );
  });

  it('lets an ordinary read through for every kind', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      await expect(verdict(state(), '/api/widgets', method)).resolves.toBeNull();
    }
  });
});

describe('a GET that transacts is refused BEFORE the method is consulted', () => {
  it('refuses an unlisted GET under a money path — the allowlist is the default', async () => {
    await expect(verdict(state(), '/api/checkout/status', 'GET')).resolves.toBe(
      'IMPERSONATION_TRANSACTION_BLOCKED',
    );
  });

  it('lets a proven-pure money read through, so the screens stay readable', async () => {
    await expect(verdict(state(), '/api/basket/b-1', 'GET')).resolves.toBeNull();
    await expect(verdict(state(), '/api/tenants/t-1/billing', 'GET')).resolves.toBeNull();
  });

  it('does not let a CHILD route ride in on its allowlisted parent', async () => {
    await expect(verdict(state(), '/api/basket/b-1/settle', 'GET')).resolves.toBe(
      'IMPERSONATION_TRANSACTION_BLOCKED',
    );
    await expect(verdict(state(), '/api/tenants/t-1/billing/card', 'GET')).resolves.toBe(
      'IMPERSONATION_TRANSACTION_BLOCKED',
    );
  });

  it('refuses money to an opted-in operator session too — no opt-in reaches it', async () => {
    await expect(
      verdict(state({ allowWrites: true }), '/api/checkout/pay', 'POST'),
    ).resolves.toBe('IMPERSONATION_TRANSACTION_BLOCKED');
  });

  it('matches on the PATH, never on a lookalike sibling', async () => {
    await expect(verdict(state(), '/api/basketball', 'POST')).resolves.toBe(
      'IMPERSONATION_READ_ONLY',
    );
  });
});

describe('nobody writes to somebody else', () => {
  it('refuses an account WRITE for every kind, opt-in included', async () => {
    await expect(
      verdict(state({ allowWrites: true }), '/api/me/notifications', 'POST'),
    ).resolves.toBe('IMPERSONATION_ACCOUNT_BLOCKED');
    await expect(
      verdict(state({ kind: 'preview', previewRoleName: 'FLOOR' }), '/api/me/profile', 'PATCH'),
    ).resolves.toBe('IMPERSONATION_ACCOUNT_BLOCKED');
  });

  it('still lets the account be READ — seeing it is most of why a session starts', async () => {
    await expect(verdict(state(), '/api/me/notifications', 'GET')).resolves.toBeNull();
  });

  it('refuses the bare prefix itself, should a route ever be served there', async () => {
    await expect(verdict(state(), '/api/me', 'POST')).resolves.toBe(
      'IMPERSONATION_ACCOUNT_BLOCKED',
    );
  });

  it('does not sweep in a different word that merely starts the same', async () => {
    await expect(verdict(state(), '/api/members', 'POST')).resolves.toBe(
      'IMPERSONATION_READ_ONLY',
    );
  });
});

describe('what each impersonation KIND may write', () => {
  it('refuses an operator session that did not opt in', async () => {
    await expect(verdict(state(), '/api/widgets', 'POST')).resolves.toBe(
      'IMPERSONATION_READ_ONLY',
    );
  });

  it('lets an operator session that opted into writes through', async () => {
    await expect(
      verdict(state({ allowWrites: true }), '/api/widgets', 'POST'),
    ).resolves.toBeNull();
  });

  it('refuses a MEMBER preview, and still lets it READ', async () => {
    const member = state({ kind: 'preview', subjectUserId: 'u-member' });
    await expect(verdict(member, '/api/widgets', 'POST')).resolves.toBe(
      'IMPERSONATION_READ_ONLY',
    );
    await expect(verdict(member, '/api/widgets', 'GET')).resolves.toBeNull();
  });

  it('lets a ROLE preview write: the subject is the actor, merely narrowed', async () => {
    await expect(
      verdict(state({ kind: 'preview', previewRoleName: 'FLOOR' }), '/api/widgets', 'POST'),
    ).resolves.toBeNull();
  });

  it('re-derives the role case from BOTH fields, so an odd combination falls to the refusal', () => {
    // An operator session that somehow carried a role name must NOT read as a
    // role preview — the combination is unexpected, and unexpected must be safe.
    expect(
      impersonationPermitsWrites({
        kind: 'operator',
        previewRoleName: 'FLOOR',
        allowWrites: false,
      }),
    ).toBe(false);
  });
});

describe('THE EXIT — a session can always be stopped', () => {
  it('lets the session verbs through on both mounts, whatever the kind', async () => {
    const member = state({ kind: 'preview', subjectUserId: 'u-member' });
    for (const method of ['GET', 'POST', 'DELETE']) {
      await expect(verdict(member, '/api/session-preview', method)).resolves.toBeNull();
      await expect(
        verdict(member, '/api/tenants/acme/session-preview', method),
      ).resolves.toBeNull();
    }
  });

  it('does not extend to any OTHER verb on an exit path', async () => {
    await expect(verdict(state(), '/api/session-preview', 'PATCH')).resolves.toBe(
      'IMPERSONATION_READ_ONLY',
    );
  });

  it('does not extend to a CHILD path of the exit', async () => {
    await expect(verdict(state(), '/api/session-preview/extend', 'POST')).resolves.toBe(
      'IMPERSONATION_READ_ONLY',
    );
  });
});

describe('THE LIVE GATE — a revoked preview stops mid-session', () => {
  const denial = new Error('revoked');
  const revoking: PreviewEntitlementPort = {
    require: async () => {
      throw denial;
    },
    isDenial: (error) => error === denial,
    denialResponse: () => ({ status: 402, message: 'upgrade' }),
  };
  const preview = state({ kind: 'preview', previewRoleName: 'FLOOR' });

  it('refuses a READ, which no other rule here does', async () => {
    await expect(
      guard({ previewEntitlement: revoking }).refusalFor({
        impersonation: preview,
        pathname: '/api/widgets',
        method: 'GET',
      }),
    ).resolves.toBe('IMPERSONATION_REVOKED');
  });

  it('refuses a write a role preview would otherwise be allowed to make', async () => {
    await expect(
      guard({ previewEntitlement: revoking }).refusalFor({
        impersonation: preview,
        pathname: '/api/widgets',
        method: 'POST',
      }),
    ).resolves.toBe('IMPERSONATION_REVOKED');
  });

  it('STILL lets the session be stopped — the exit is asked first', async () => {
    await expect(
      guard({ previewEntitlement: revoking }).refusalFor({
        impersonation: preview,
        pathname: '/api/session-preview',
        method: 'DELETE',
      }),
    ).resolves.toBeNull();
  });

  it('never asks about an OPERATOR session — platform authority is not a tenant setting', async () => {
    const require = vi.fn(async () => undefined);
    await expect(
      guard({
        previewEntitlement: { require, isDenial: () => true, denialResponse: () => ({ status: 402, message: 'x' }) },
      }).refusalFor({ impersonation: state(), pathname: '/api/widgets', method: 'GET' }),
    ).resolves.toBeNull();
    expect(require).not.toHaveBeenCalled();
  });

  it('FAILS OPEN on an unexpected error, and reports it', async () => {
    const onError = vi.fn();
    const flaky: PreviewEntitlementPort = {
      require: async () => {
        throw new Error('database blip');
      },
      isDenial: () => false,
      denialResponse: () => ({ status: 402, message: 'x' }),
    };
    await expect(
      guard({ previewEntitlement: flaky, onError }).refusalFor({
        impersonation: preview,
        pathname: '/api/widgets',
        method: 'GET',
      }),
    ).resolves.toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('is ungated entirely when the host configured no entitlement port', async () => {
    await expect(verdict(preview, '/api/widgets', 'GET')).resolves.toBeNull();
  });
});

describe('the refusal', () => {
  it('throws with the code and the HOST\'s own sentence', async () => {
    await expect(
      guard().assertAllowed({
        impersonation: state(),
        pathname: '/api/widgets',
        method: 'POST',
      }),
    ).rejects.toMatchObject({
      code: 'IMPERSONATION_READ_ONLY',
      status: 403,
      message: TEST_MESSAGES.readOnly,
    });
  });

  it('says something different when money is the reason', async () => {
    await expect(
      guard().assertAllowed({
        impersonation: state(),
        pathname: '/api/checkout/pay',
        method: 'POST',
      }),
    ).rejects.toMatchObject({ message: TEST_MESSAGES.transactionBlocked });
  });

  it('is an ImpersonationRefusedError across the ES5 extends downlevel', async () => {
    const error = await guard()
      .assertAllowed({ impersonation: state(), pathname: '/api/me/x', method: 'POST' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ImpersonationRefusedError);
  });

  it('resolves silently for a request the gate allows', async () => {
    await expect(
      guard().assertAllowed({ impersonation: state(), pathname: '/api/widgets', method: 'GET' }),
    ).resolves.toBeUndefined();
  });
});

describe('THE TENANT BOUND — a session reaches ONE tenant, ever', () => {
  /**
   * Shipped rather than left to each host because getting it wrong is silent:
   * the gate above checks the PATH and the KIND and never the scope, so a
   * session bounded to one tenant would read another with nothing in any log.
   */
  it('refuses a scope that is not the session\'s', () => {
    expect(outsideBoundedTenant({ tenantId: 't-1' }, 't-1')).toBe(false);
    expect(outsideBoundedTenant({ tenantId: 't-1' }, 't-2')).toBe(true);
  });

  it("exempts the scopes that are not a tenant at all", () => {
    const exempt = (scope: string) => scope === 'GLOBAL' || scope.startsWith('org:');
    // The app shell's own reads resolve against the SUBJECT's grants like
    // everything else; refusing them would break the chrome around a valid
    // session.
    expect(outsideBoundedTenant({ tenantId: 't-1' }, 'GLOBAL', exempt)).toBe(false);
    expect(outsideBoundedTenant({ tenantId: 't-1' }, 'org:acme', exempt)).toBe(false);
    // …and a real tenant scope is still bounded, so the exemption is never
    // taken on the path that matters.
    expect(outsideBoundedTenant({ tenantId: 't-1' }, 't-2', exempt)).toBe(true);
  });
});

describe('WHICH CEILING a host must apply', () => {
  it('names one per kind, so a host cannot silently skip the narrowing', () => {
    expect(previewCeilingKind({ kind: 'operator', previewRoleName: null })).toBe('none');
    expect(previewCeilingKind({ kind: 'preview', previewRoleName: 'FLOOR' })).toBe('role');
    expect(previewCeilingKind({ kind: 'preview', previewRoleName: null })).toBe('actor');
  });
});
