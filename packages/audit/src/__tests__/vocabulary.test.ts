/* eslint-disable test-flakiness/no-test-isolation --
   `index` is a module-level CONST — an immutable indexed vocabulary, shared on
   purpose and mutated by nothing. */
import { describe, expect, it } from 'vitest';

import {
  AuditVocabularyError,
  FUTURE_PAY_AUDIT_VOCABULARY,
  indexVocabulary,
  redactDiff,
} from '../index';

/**
 * The vocabulary and the deny-by-default redaction (12-14) — ported from
 * future-pay's `lib/audit/__tests__/audit.test.ts` redaction cases, against the
 * config-driven allowlist that replaced its hard-coded map.
 */
const index = indexVocabulary(FUTURE_PAY_AUDIT_VOCABULARY);

describe('redactDiff', () => {
  it('keeps only allowlisted fields — unknown keys are dropped silently', () => {
    expect(
      redactDiff(index, 'order', {
        status: 'PAID',
        buyerEmail: 'pii@example.com',
        rawPayload: '{secret}',
      }),
    ).toEqual({ status: 'PAID' });
  });

  it('serializes Dates to ISO and drops nested objects (a diff is flat)', () => {
    const closedAt = new Date('2026-07-24T12:00:00Z');
    expect(
      redactDiff(index, 'table_session', {
        closedAt,
        status: { nested: true },
        tableId: null,
      }),
    ).toEqual({ closedAt: '2026-07-24T12:00:00.000Z', tableId: null });
  });

  it('returns an empty diff for an absent input', () => {
    expect(redactDiff(index, 'order', undefined)).toEqual({});
  });

  it('keeps operational shift fields while dropping unrelated identity data', () => {
    expect(
      redactDiff(index, 'shift', {
        userId: 'cook-a',
        endedReason: 'auto',
        endedAt: new Date('2026-07-30T16:00:00.000Z'),
        resourceType: 'kitchen-stations',
        resourceId: 'grill',
        userEmail: 'private@example.com',
      }),
    ).toEqual({
      userId: 'cook-a',
      endedReason: 'auto',
      endedAt: '2026-07-30T16:00:00.000Z',
      resourceType: 'kitchen-stations',
      resourceId: 'grill',
    });
  });

  it('keeps every field BOTH impersonation writers emit', () => {
    // The allowlist is deny-by-default PER RESOURCE TYPE, and the two writers —
    // the platform trail and the tenant preview routes — emit overlapping but
    // different keys. A field only one of them uses still has to be listed, or
    // that writer's entries come back hollow and the action name is the only
    // thing the row says.
    const emitted = {
      kind: 'preview',
      previewAs: 'member',
      memberUserId: 'u-waiter',
      roleName: 'GARCOM',
      targetUserId: 'u-target',
      targetApp: 'admin',
      reason: 'reproduzir bug de checkout',
      allowWrites: false,
      readOnly: true,
      expiresAt: '2026-08-01T12:10:00.000Z',
      refusal: 'not_superadmin',
      actorEmail: 'ops@futurepay.test',
      code: 'NOT_A_MEMBER',
      enabled: true,
    };
    expect(redactDiff(index, 'impersonation', emitted)).toEqual(emitted);
  });

  it('still drops unrelated identity data from an impersonation diff', () => {
    expect(
      redactDiff(index, 'impersonation', {
        code: 'NOT_ENTITLED',
        targetEmail: 'diner@example.com',
      }),
    ).toEqual({ code: 'NOT_ENTITLED' });
  });

  it('THROWS for an unknown resource type instead of writing a hollow row', () => {
    // future-pay's map lookup would have crashed with a TypeError on
    // `allowed.has`; a host adding a resource type it forgot to declare deserves
    // to be told which one, and inside the caller's transaction, so nothing lands.
    expect(() => redactDiff(index, 'invoice', { total: 1 })).toThrow(AuditVocabularyError);
    expect(() => redactDiff(index, 'invoice', { total: 1 })).toThrow(/invoice/);
  });
});

describe('indexVocabulary', () => {
  it('refuses a duplicate action or resource id', () => {
    // Last-one-wins would mean two labels for one action and a reader seeing
    // whichever declaration came second.
    expect(() =>
      indexVocabulary({
        actions: [
          { id: 'a.b', label: 'One' },
          { id: 'a.b', label: 'Two' },
        ],
        resources: [],
      }),
    ).toThrow(/Duplicate audit action "a.b"/);
    expect(() =>
      indexVocabulary({
        actions: [],
        resources: [
          { id: 'thing', label: 'One', fields: [] },
          { id: 'thing', label: 'Two', fields: [] },
        ],
      }),
    ).toThrow(/Duplicate audit resource "thing"/);
  });

  it('falls back to the raw id when something unlabelled is asked for', () => {
    // Defensive on READ only: an entry written before an action was renamed still
    // renders, as its id, rather than as an empty cell.
    expect(index.actionLabel('order.cancel')).toBe('Pedido cancelado');
    expect(index.actionLabel('mystery.event')).toBe('mystery.event');
    expect(index.resourceLabel('order')).toBe('Pedido');
    expect(index.resourceLabel('mystery')).toBe('mystery');
  });
});

describe('the Future Pay vocabulary', () => {
  it('labels EVERY action and resource it declares', () => {
    // THE drift this single value exists to close. In future-pay the writer's
    // action list lived in `lib/audit/actions.ts` and the viewer's labels in the
    // admin SPA, and nine actions the writer could emit had no label at all —
    // `payment.over`, `payment.refund`, `payment.dispute`,
    // `payment.short.resolved`, `comanda.reopen`, `plan.assign`,
    // `plan.override_set`, `discount.redeem` and every `impersonation.*` — so
    // those rows rendered a raw dotted id to a store owner.
    const unlabelled = FUTURE_PAY_AUDIT_VOCABULARY.actions.filter(
      (action) => !action.label || action.label === action.id,
    );
    expect(unlabelled).toEqual([]);
    const unlabelledResources = FUTURE_PAY_AUDIT_VOCABULARY.resources.filter(
      (resource) => !resource.label || resource.label === resource.id,
    );
    expect(unlabelledResources).toEqual([]);
  });

  it('declares an allowlist for every resource, and a non-empty one', () => {
    const empty = FUTURE_PAY_AUDIT_VOCABULARY.resources.filter(
      (resource) => resource.fields.length === 0,
    );
    expect(empty).toEqual([]);
  });

  it('carries every action future-pay could write', () => {
    // A spot check on the ones whose absence would silently disable a host read:
    // the reconciliation lists select on these literals.
    for (const action of [
      'payment.short',
      'payment.over',
      'payment.refund',
      'payment.dispute',
      'payment.short.resolved',
      'impersonation.start',
      'impersonation.end',
      'impersonation.refused',
      'impersonation.configured',
    ]) {
      expect(index.hasAction(action)).toBe(true);
    }
  });

  it('never lets a diff carry buyer contact data for any resource', () => {
    // A property over the WHOLE vocabulary rather than one case per resource: a
    // future allowlist entry named `email`/`phone`/`cpf`/`document` would put
    // contact data into an append-only table, where it cannot be deleted.
    const forbidden = /email|phone|telefone|cpf|cnpj|document|address|endereco/i;
    const offenders = FUTURE_PAY_AUDIT_VOCABULARY.resources.flatMap((resource) =>
      resource.fields
        .filter((field) => forbidden.test(field))
        .map((field) => `${resource.id}.${field}`),
    );
    // `impersonation.actorEmail` is the ONE exception, and it is the operator's
    // own address (the person who opened the session), not a buyer's.
    expect(offenders).toEqual(['impersonation.actorEmail']);
  });
});
