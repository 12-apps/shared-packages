import { describe, expect, it } from 'vitest';

import { createSessionCodec, toImpersonationState } from '../core/session';
import type { StartImpersonationInput } from '../core/session';

import { TEST_TIME_BOX, testCodec } from './fixtures';

/**
 * The cookie codec — the one piece of this package a host cannot replace, and
 * therefore the one whose refusals are worth stating exhaustively.
 */

const NOW = Date.parse('2026-05-01T12:00:00.000Z');

function codec(options: { key?: string; secure?: boolean } = {}) {
  return createSessionCodec({
    cookieName: 'toy_impersonation',
    secure: options.secure ?? false,
    codec: testCodec(options.key),
    timeBox: TEST_TIME_BOX,
  });
}

const operatorInput: StartImpersonationInput = {
  kind: 'operator',
  realUserId: 'u-actor',
  targetUserId: 'u-target',
  targetApp: 'console',
  tenantId: 't-1',
  reason: 'reproducing a reported problem',
};

describe('round trip', () => {
  it('recovers an operator session with the window the server chose', () => {
    const subject = codec();
    const { session, cookie } = subject.start(operatorInput, { now: NOW });

    expect(session).toMatchObject({
      kind: 'operator',
      targetUserId: 'u-target',
      issuedAt: NOW,
      expiresAt: NOW + TEST_TIME_BOX.operator,
    });
    expect(subject.read({ cookieValue: cookie.value, now: NOW + 1000 })).toEqual(session);
  });

  it('defaults an operator session to read-only, keeping an explicit opt-in', () => {
    const subject = codec();
    expect(subject.start(operatorInput, { now: NOW }).session).toMatchObject({
      allowWrites: false,
    });
    expect(
      subject.start({ ...operatorInput, allowWrites: true }, { now: NOW }).session,
    ).toMatchObject({ allowWrites: true });
  });

  it('recovers both preview subjects on the shorter preview window', () => {
    const subject = codec();
    const role = subject.start(
      { kind: 'preview', realUserId: 'u-actor', tenantId: 't-1', previewOf: { as: 'role', roleName: 'FLOOR' } },
      { now: NOW },
    );
    const member = subject.start(
      {
        kind: 'preview',
        realUserId: 'u-actor',
        tenantId: 't-1',
        previewOf: { as: 'member', memberUserId: 'u-member' },
      },
      { now: NOW },
    );

    expect(role.session.expiresAt).toBe(NOW + TEST_TIME_BOX.preview);
    expect(subject.read({ cookieValue: role.cookie.value, now: NOW })).toMatchObject({
      previewOf: { as: 'role', roleName: 'FLOOR' },
    });
    expect(subject.read({ cookieValue: member.cookie.value, now: NOW })).toMatchObject({
      previewOf: { as: 'member', memberUserId: 'u-member' },
    });
  });

  it('keeps the payload off the wire in cleartext', () => {
    const { cookie } = codec().start(operatorInput, { now: NOW });
    expect(cookie.value).not.toContain('u-target');
    expect(cookie.value).not.toContain('reproducing');
  });

  it('plants an httpOnly, lax, root-scoped cookie that expires with the window', () => {
    const { cookie } = codec({ secure: true }).start(operatorInput, { now: NOW });
    expect(cookie.options).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: TEST_TIME_BOX.operator / 1000,
    });
  });
});

describe('refusals', () => {
  it('refuses a tampered payload instead of throwing', () => {
    const subject = codec();
    const { cookie } = subject.start(operatorInput, { now: NOW });
    const edited = `${cookie.value.slice(0, -1)}${cookie.value.at(-1) === 'a' ? 'b' : 'a'}`;
    expect(subject.read({ cookieValue: edited, now: NOW })).toBeNull();
  });

  it('refuses a well-formed cookie whose absolute window has closed', () => {
    const subject = codec();
    const { cookie } = subject.start(operatorInput, { now: NOW });
    expect(subject.read({ cookieValue: cookie.value, now: NOW + TEST_TIME_BOX.operator }))
      .toBeNull();
  });

  it('refuses a payload that decrypts but is not a session', () => {
    const subject = codec();
    const smuggled = testCodec().encrypt(JSON.stringify({ kind: 'operator' }));
    expect(subject.read({ cookieValue: smuggled, now: NOW })).toBeNull();
  });

  it('refuses a payload claiming a longer window than this build allows', () => {
    const subject = codec();
    const overlong = testCodec().encrypt(
      JSON.stringify({
        ...operatorInput,
        allowWrites: false,
        issuedAt: NOW,
        expiresAt: NOW + TEST_TIME_BOX.operator * 4,
      }),
    );
    expect(subject.read({ cookieValue: overlong, now: NOW })).toBeNull();
  });

  it('refuses a cookie minted under a different key', () => {
    const { cookie } = codec({ key: 'old' }).start(operatorInput, { now: NOW });
    expect(codec({ key: 'new' }).read({ cookieValue: cookie.value, now: NOW })).toBeNull();
  });

  it('refuses an absent cookie', () => {
    expect(codec().read({ cookieValue: undefined, now: NOW })).toBeNull();
  });
});

describe('machine tokens', () => {
  it('refuses the cookie on a request authenticated by a machine token', () => {
    const subject = codec();
    const { cookie } = subject.start(operatorInput, { now: NOW });
    expect(
      subject.read({ cookieValue: cookie.value, isMachineToken: true, now: NOW }),
    ).toBeNull();
    expect(
      subject.read({ cookieValue: cookie.value, isMachineToken: false, now: NOW }),
    ).not.toBeNull();
  });
});

describe('no sliding renewal', () => {
  it('does not extend the window by reading it, however often it is read', () => {
    const subject = codec();
    const { cookie } = subject.start(operatorInput, { now: NOW });
    for (let tick = 0; tick < 5; tick += 1) {
      subject.read({ cookieValue: cookie.value, now: NOW + tick * 60_000 });
    }
    expect(subject.read({ cookieValue: cookie.value, now: NOW })?.expiresAt).toBe(
      NOW + TEST_TIME_BOX.operator,
    );
  });

  it('ignores a time box smuggled past the type', () => {
    const smuggled = {
      ...operatorInput,
      issuedAt: 1,
      expiresAt: NOW + TEST_TIME_BOX.operator * 10,
    } as unknown as StartImpersonationInput;
    const { session } = codec().start(smuggled, { now: NOW });
    expect(session.issuedAt).toBe(NOW);
    expect(session.expiresAt).toBe(NOW + TEST_TIME_BOX.operator);
  });
});

describe('ending a session', () => {
  it('drops the cookie on the same name and path the writer used', () => {
    const subject = codec();
    const cleared = subject.end();
    expect(cleared.name).toBe(subject.cookieName);
    expect(cleared.value).toBe('');
    expect(cleared.options.maxAge).toBe(0);
    expect(cleared.options.path).toBe('/');
  });
});

describe('the presence probe', () => {
  it('reads the header rather than decoding, and never false-negatives', () => {
    const subject = codec();
    expect(subject.present('other=1; toy_impersonation=abc')).toBe(true);
    expect(subject.present('other=1')).toBe(false);
    expect(subject.present(null)).toBe(false);
  });
});

describe('collapsing a session into the state every guard reads', () => {
  const subject = codec();
  const live = (input: StartImpersonationInput) => subject.start(input, { now: NOW }).session;

  it('refuses a cookie that names a different real human', () => {
    expect(toImpersonationState(live(operatorInput), 'u-someone-else')).toBeNull();
  });

  it('refuses when the real human has no resolvable id', () => {
    expect(toImpersonationState(live(operatorInput), null)).toBeNull();
  });

  it('resolves an operator session AS the target, carrying the opt-in', () => {
    const state = toImpersonationState(
      live({ ...operatorInput, allowWrites: true }),
      'u-actor',
    );
    expect(state).toMatchObject({
      kind: 'operator',
      subjectUserId: 'u-target',
      realUserId: 'u-actor',
      allowWrites: true,
      previewRoleName: null,
    });
  });

  it('resolves a member preview AS the member, always read-only', () => {
    const state = toImpersonationState(
      live({
        kind: 'preview',
        realUserId: 'u-actor',
        tenantId: 't-1',
        previewOf: { as: 'member', memberUserId: 'u-member' },
      }),
      'u-actor',
    );
    expect(state).toMatchObject({
      subjectUserId: 'u-member',
      allowWrites: false,
      previewRoleName: null,
    });
  });

  it('resolves a role preview as the ACTOR, narrowed by the role', () => {
    const state = toImpersonationState(
      live({
        kind: 'preview',
        realUserId: 'u-actor',
        tenantId: 't-1',
        previewOf: { as: 'role', roleName: 'FLOOR' },
      }),
      'u-actor',
    );
    expect(state).toMatchObject({
      subjectUserId: 'u-actor',
      allowWrites: false,
      previewRoleName: 'FLOOR',
    });
  });
});
