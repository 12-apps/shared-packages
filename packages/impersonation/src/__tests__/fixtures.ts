import type {
  ImpersonationActor,
  ImpersonationMessages,
  ImpersonationServerConfig,
} from '../server/context';
import type {
  ImpersonationAuditPort,
  ImpersonationDirectory,
  ImpersonationEndEntry,
  ImpersonationRefusedEntry,
  ImpersonationStartEntry,
} from '../server/ports';
import type { ImpersonationCodec } from '../core/session';
import type { ImpersonationTarget, ImpersonationTenant, ImpersonationUser } from '../core/types';

/**
 * The fixtures every suite in this package shares — a reversible stand-in for
 * the host's cipher, an in-memory directory, a recording trail, and a config in
 * a vocabulary that belongs to no real product.
 *
 * The words are deliberately nobody's. If a suite here started asserting one
 * application's sentences, the package would acquire that application's voice by
 * the back door — the exact failure the required-`messages` contract exists to
 * prevent.
 */

/**
 * A reversible, TAMPER-EVIDENT stand-in for the host's authenticated cipher.
 *
 * A plain base64 would round-trip an edited payload, so every "refuses a
 * tampered cookie" test would pass for the wrong reason. This appends a checksum
 * and throws when it does not match, which is the one property the real codec is
 * chosen for.
 */
export function testCodec(key = 'k1'): ImpersonationCodec {
  const sum = (text: string): string =>
    [...`${key}:${text}`]
      .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 0)
      .toString(36);
  return {
    encrypt(plaintext) {
      return `${Buffer.from(plaintext, 'utf8').toString('base64url')}.${sum(plaintext)}`;
    },
    decrypt(ciphertext) {
      const dot = ciphertext.lastIndexOf('.');
      if (dot < 0) throw new Error('malformed');
      const plaintext = Buffer.from(ciphertext.slice(0, dot), 'base64url').toString('utf8');
      if (sum(plaintext) !== ciphertext.slice(dot + 1)) throw new Error('bad tag');
      return plaintext;
    },
  };
}

/** Every sentence, in words that belong to no product. */
export const TEST_MESSAGES: ImpersonationMessages = {
  machineTokenRefused: 'a token cannot open a session',
  notAuthorized: 'not allowed here',
  actorNotRecorded: 'your account has no record to attribute this to',
  targetIsPlatformAdmin: 'cannot open another operator account',
  targetNotFound: 'no such account',
  notAMember: 'not on this tenant',
  alreadyImpersonating: 'end the current session first',
  tenantNotFound: 'no such tenant',
  invalidBody: 'invalid request',
  readOnly: 'this session cannot change anything',
  transactionBlocked: 'money cannot move here',
  accountBlocked: 'account settings are somebody else',
  revoked: 'the preview was switched off',
};

export interface DirectoryState {
  users: Map<string, ImpersonationTarget>;
  tenants: Map<string, ImpersonationTenant>;
  memberships: Set<string>;
}

export function memberKey(userId: string, tenantId: string): string {
  return `${userId}@${tenantId}`;
}

export function createTestDirectory(): {
  directory: ImpersonationDirectory;
  state: DirectoryState;
} {
  const state: DirectoryState = {
    users: new Map(),
    tenants: new Map(),
    memberships: new Set(),
  };
  const bare = (target: ImpersonationTarget): ImpersonationUser => ({
    id: target.id,
    email: target.email,
    name: target.name,
  });
  return {
    state,
    directory: {
      findUser: async (id) => {
        const user = state.users.get(id);
        return user ? bare(user) : null;
      },
      resolveTarget: async (id) => state.users.get(id) ?? null,
      findTenant: async (id) => state.tenants.get(id) ?? null,
      findTenantBySlug: async (slug) =>
        [...state.tenants.values()].find((tenant) => tenant.slug === slug) ?? null,
      isActiveMember: async (userId, tenantId) =>
        state.memberships.has(memberKey(userId, tenantId)),
    },
  };
}

export interface RecordedTrail {
  started: ImpersonationStartEntry[];
  ended: ImpersonationEndEntry[];
  refused: ImpersonationRefusedEntry[];
}

export function createTestAudit(): { audit: ImpersonationAuditPort; trail: RecordedTrail } {
  const trail: RecordedTrail = { started: [], ended: [], refused: [] };
  return {
    trail,
    audit: {
      started: async (entry) => void trail.started.push(entry),
      ended: async (entry) => void trail.ended.push(entry),
      refused: async (entry) => void trail.refused.push(entry),
    },
  };
}

/** An actor in the default shape: signed in, ordinary, holding nothing. */
export function actor(overrides: Partial<ImpersonationActor> = {}): ImpersonationActor {
  return {
    userId: 'u-actor',
    email: 'actor@example.test',
    isPlatformAdmin: false,
    permissions: [],
    isMachineToken: false,
    ...overrides,
  };
}

export const TEST_TIME_BOX = { operator: 30 * 60 * 1000, preview: 10 * 60 * 1000 };

/**
 * A whole server config, in the toy host's own words.
 *
 * The path tables are the toy host's URL layout and nothing else — no real
 * product's routes appear anywhere in this package, tests included.
 */
export function testServerConfig(
  overrides: Partial<ImpersonationServerConfig> = {},
): ImpersonationServerConfig {
  const { directory } = createTestDirectory();
  const { audit } = createTestAudit();
  return {
    cookieName: 'toy_impersonation',
    secure: false,
    codec: testCodec(),
    timeBox: TEST_TIME_BOX,
    paths: {
      money: [/^\/api\/(basket|checkout)(\/|$)/, /^\/api\/tenants\/[^/]+\/billing(\/|$)/],
      moneyReads: [/^\/api\/basket\/[^/]+$/, /^\/api\/tenants\/[^/]+\/billing$/],
      account: [/^\/api\/me(\/|$)/],
      session: [/^\/api\/session-preview$/, /^\/api\/tenants\/[^/]+\/session-preview$/],
    },
    directory,
    audit,
    mintPolicy: {
      targetApps: ['console', 'storefront'],
      reasonLength: { min: 15, max: 280 },
    },
    previewPermission: 'user:impersonate',
    messages: TEST_MESSAGES,
    ...overrides,
  };
}
