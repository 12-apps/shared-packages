/**
 * The TOY SECOND HOST — the acceptance gate for portability (FUT-131).
 *
 * A complete, runnable note-taking SaaS wired to the library with ONLY its own
 * feature catalog, its own plans and the two ports. It deliberately imports
 * NOTHING from `./fixtures` and nothing from Future Pay. If this suite compiles
 * and passes, the core is portable: nothing in it presumes restaurants,
 * tenants named `Client`, Prisma, Next.js — or billing.
 *
 * Mirrors the toy-blog host `@12-apps/rbac` ships for FUT-146.
 */
import { describe, expect, it } from 'vitest';

import { createEntitlements } from '../core/engine';
import { EntitlementRequiredError, QuotaExceededError } from '../core/errors';
import { definePlans } from '../core/plans';
import { defineFeatures } from '../core/registry';
import type { EntitlementSource, UsageCounter } from '../core/types';

// ── The note app's own catalog (nothing shared with Future Pay) ─────────────
const NOTE_FEATURES = defineFeatures({
  'notes.read': { retainWhenRestricted: true },
  'notes.export': { onRevoke: 'hide' },
  'ai.assist': { onRevoke: 'disable' },
  'workspace.seats': { kind: 'quota', onRevoke: 'readonly' },
  'audit.trail': { onRevoke: 'hide', defaultWhenEntitled: false },
} as const);

type NoteFeature = (typeof NOTE_FEATURES.list)[number];

const NOTE_PLANS = definePlans(NOTE_FEATURES, {
  free: { entitlements: { 'notes.read': true, 'workspace.seats': 1 } },
  team: {
    extends: 'free',
    entitlements: { 'notes.export': true, 'workspace.seats': 10 },
  },
  business: {
    extends: 'team',
    entitlements: {
      'ai.assist': true,
      'audit.trail': true,
      'workspace.seats': 'unlimited',
    },
  },
} as const);

// ── The note app's "database": plain objects, no ORM anywhere ───────────────
interface Workspace {
  plan: 'free' | 'team' | 'business';
  seatsUsed: number;
  suspended?: boolean;
  overdue?: boolean;
  turnedOff?: NoteFeature[];
  comped?: NoteFeature[];
}

/**
 * Stands the entire toy host up from scratch: its row store, its two port
 * implementations, and an engine bound to them.
 *
 * Every test builds its own host rather than sharing one. The downgrade
 * scenario rewrites a workspace row in place — exactly as a real billing
 * webhook would — so a shared store would let that rewrite decide what a
 * later test sees. Handing each test a private store keeps the suite's verdict
 * a property of the library rather than of the file's execution order.
 *
 * It also reinforces what this file is asserting: the HOST owns the data and
 * the plumbing, the library owns nothing. Building the whole thing in one
 * ~30-line function is itself part of the evidence.
 */
function createNoteHost() {
  // The note app's entire "database": one plain object, no ORM anywhere. It is
  // re-seeded on every call, which is what makes the mutating scenarios safe.
  const db: Record<string, Workspace> = {
    'ws-solo': { plan: 'free', seatsUsed: 1 },
    'ws-startup': { plan: 'team', seatsUsed: 10 },
    'ws-corp': { plan: 'business', seatsUsed: 250 },
    'ws-late': { plan: 'team', seatsUsed: 4, overdue: true },
    'ws-dead': { plan: 'business', seatsUsed: 4, suspended: true },
    'ws-friend': { plan: 'free', seatsUsed: 1, comped: ['ai.assist'] },
    'ws-quiet': { plan: 'business', seatsUsed: 2, turnedOff: ['ai.assist'] },
  };

  // Port 1 of 2 — reads a row and translates it into the library's vocabulary.
  const source: EntitlementSource<NoteFeature> = {
    async load(tenantId) {
      const ws = db[tenantId];
      if (!ws) return { plan: {} };
      return {
        plan: NOTE_PLANS.get(ws.plan).entitlements,
        planKey: ws.plan,
        overrides: Object.fromEntries((ws.comped ?? []).map((f) => [f, true])),
        settings: Object.fromEntries((ws.turnedOff ?? []).map((f) => [f, false])),
        status: ws.suspended ? 'suspended' : ws.overdue ? 'restricted' : 'active',
      };
    },
  };

  // Port 2 of 2 — the host, not the library, decides what "used" means.
  const usage: UsageCounter<NoteFeature> = {
    async count(tenantId) {
      return db[tenantId]?.seatsUsed ?? 0;
    },
  };

  return {
    workspaces: db,
    notes: createEntitlements({
      features: NOTE_FEATURES,
      plans: NOTE_PLANS,
      source,
      usage,
    }),
  };
}

// ───────────────────────────────────────────────────────────────────────────

describe('toy host: gating', () => {
  it('grants what the tier includes and denies what it does not', async () => {
    const { notes } = createNoteHost();
    expect((await notes.check('ws-solo', 'notes.read')).enabled).toBe(true);
    expect((await notes.check('ws-solo', 'notes.export')).enabled).toBe(false);
    expect((await notes.check('ws-startup', 'notes.export')).enabled).toBe(true);
    expect((await notes.check('ws-corp', 'ai.assist')).enabled).toBe(true);
  });

  it('names the cheapest tier that would unlock a denied feature', async () => {
    const { notes } = createNoteHost();
    const error = await notes
      .require('ws-solo', 'ai.assist')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EntitlementRequiredError);
    expect((error as EntitlementRequiredError<NoteFeature>).requiredPlan).toBe(
      'business',
    );
  });

  it('honours a comped override on the cheapest tier', async () => {
    const { notes } = createNoteHost();
    expect((await notes.check('ws-friend', 'ai.assist')).enabled).toBe(true);
    expect((await notes.check('ws-friend', 'notes.export')).enabled).toBe(false);
  });

  it('lets a workspace switch off something it pays for', async () => {
    const { notes } = createNoteHost();
    const decision = await notes.check('ws-quiet', 'ai.assist');
    expect(decision).toMatchObject({
      enabled: false,
      reason: 'disabled-by-tenant',
      requiredPlan: null,
    });
  });

  it('keeps opt-in features off until the workspace asks for them', async () => {
    const { notes } = createNoteHost();
    expect((await notes.check('ws-corp', 'audit.trail')).reason).toBe(
      'disabled-by-tenant',
    );
  });
});

describe('toy host: quotas', () => {
  it('reports seats against the tier ceiling', async () => {
    const { notes } = createNoteHost();
    expect(await notes.checkQuota('ws-startup', 'workspace.seats')).toMatchObject(
      { limit: 10, used: 10, remaining: 0, exceeded: true },
    );
  });

  it('refuses a new seat at the ceiling and upsells past it', async () => {
    const { notes } = createNoteHost();
    const error = await notes
      .requireQuota('ws-startup', 'workspace.seats')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect((error as QuotaExceededError<NoteFeature>).requiredPlan).toBe(
      'business',
    );
  });

  it('never caps an unlimited tier', async () => {
    const { notes } = createNoteHost();
    const decision = await notes.checkQuota('ws-corp', 'workspace.seats');
    expect(decision.exceeded).toBe(false);
    expect(decision.limit).toBe('unlimited');
  });
});

describe('toy host: downgrade preserves data', () => {
  it('leaves over-quota rows alone and only refuses new ones', async () => {
    // This host is private to this test, so rewriting a row below is a
    // downgrade the host performed on its OWN data — not a booby trap for
    // whatever test happens to run next.
    const { notes, workspaces } = createNoteHost();

    workspaces['ws-startup'] = { plan: 'free', seatsUsed: 10 };
    const decision = await notes.checkQuota('ws-startup', 'workspace.seats');
    expect(decision.used).toBe(10); // the 10 seats still exist
    expect(decision.limit).toBe(1);
    expect(decision.exceeded).toBe(true);
    expect(decision.policy).toBe('readonly'); // host keeps them read-only
    await expect(
      notes.requireQuota('ws-startup', 'workspace.seats'),
    ).rejects.toThrow(QuotaExceededError);

    // Re-upgrade restores everything with no data migration.
    workspaces['ws-startup'] = { plan: 'team', seatsUsed: 10 };
    expect((await notes.check('ws-startup', 'notes.export')).enabled).toBe(true);
  });
});

describe('toy host: lifecycle status', () => {
  it('degrades a delinquent workspace instead of bricking it', async () => {
    const { notes } = createNoteHost();
    expect((await notes.check('ws-late', 'notes.read')).enabled).toBe(true);
    expect((await notes.check('ws-late', 'notes.export'))).toMatchObject({
      enabled: false,
      reason: 'restricted',
      requiredPlan: null,
    });
  });

  it('suspends everything, retained features included', async () => {
    const { notes } = createNoteHost();
    expect((await notes.check('ws-dead', 'notes.read'))).toMatchObject({
      enabled: false,
      reason: 'suspended',
    });
  });
});

describe('toy host: snapshot for the browser', () => {
  it('serializes cleanly', async () => {
    const { notes } = createNoteHost();
    const snapshot = await notes.toSnapshot('ws-corp');
    expect(snapshot.planKey).toBe('business');
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('toy host: a host with no plans at all still gates', () => {
  it('works with hand-assigned entitlements and simply offers no upsell', async () => {
    const planless = createEntitlements<NoteFeature>({
      features: NOTE_FEATURES,
      source: {
        async load() {
          return { plan: { 'notes.read': true } };
        },
      },
    });
    expect((await planless.check('anyone', 'notes.read')).enabled).toBe(true);
    const denied = await planless.check('anyone', 'ai.assist');
    expect(denied.enabled).toBe(false);
    expect(denied.requiredPlan).toBeNull();
  });
});
