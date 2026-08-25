/* eslint-disable test-flakiness/no-test-isolation --
   every vocabulary below is built inside the case that uses it, or by a factory
   called per case; the heuristic reads the `const` names as shared state. */
import { describe, expect, it } from 'vitest';

import { AuditConfigError, AuditVocabularyError } from '../core/errors';
import {
  assertAuditVocabulary,
  defineAuditVocabulary,
  redactDiff,
  type AuditActionOf,
  type AuditResourceOf,
} from '../core/vocabulary';

/**
 * The vocabulary factory and the deny-by-default redaction.
 *
 * ## What this file replaced, and what happened to each assertion
 *
 * The suite this grew out of tested one application's catalog — the values this
 * package used to publish. The table is here rather than only in the PR,
 * because a disposition kept next to the code is one a later reader can check:
 *
 * | Old assertion | Disposition |
 * | --- | --- |
 * | `redactDiff` keeps allowlisted fields, drops unknown keys | **ported** — re-fixtured onto the archive vocabulary below |
 * | `redactDiff` serializes Dates and drops nested objects | **ported** — re-fixtured |
 * | `redactDiff` returns `{}` for an absent input | **ported** — re-fixtured |
 * | `redactDiff` keeps operational fields, drops identity data | **ported** — re-fixtured; the origin's `shift` resource became a generic one |
 * | "keeps every field BOTH impersonation writers emit" | **ported** — the property (one allowlist is the UNION of what several writers of a shared resource emit) survives as a generic case; the origin's fourteen field names did not |
 * | "still drops unrelated identity data from an impersonation diff" | **ported** — re-fixtured |
 * | `redactDiff` THROWS for an unknown resource type | **ported verbatim** |
 * | `indexVocabulary` refuses a duplicate action / resource id | **promoted** — ids are map KEYS now, so a duplicate cannot be written; the case asserts the collapse is documented and that the ORDER a reader depends on is preserved |
 * | falls back to the raw id for something unlabelled | **ported** — still the read-side behaviour, and now beside its opposite: a BLANK label is refused at assembly |
 * | "labels EVERY action and resource it declares" | **promoted** to a runtime refusal (`requireLabel`), so no host can get it wrong rather than one host being asserted right |
 * | "declares an allowlist for every resource, and a non-empty one" | **promoted** to a runtime refusal (`freezeFields`), same reason |
 * | "carries every action the origin host could write" | **dropped** — host data. Those literals are the host's, asserted where the host declares them |
 * | "never lets a diff carry buyer contact data for any resource" | **dropped** — host data. It scanned one application's field names for `email\|cpf\|…`; the generic property it stood for (a field not declared is never written) is what every `redactDiff` case here asserts |
 *
 * No coverage of generic logic was dropped because its fixture was host-shaped;
 * the fixtures were replaced.
 */

/** A public film archive — nothing this package was extracted from. */
function archive() {
  return defineAuditVocabulary({
    actions: {
      'reel.ingest': { label: 'Reel ingested' },
      'reel.deaccession': { label: 'Reel deaccessioned' },
      'screening.schedule': { label: 'Screening scheduled' },
    },
    resources: {
      reel: {
        label: 'Reel',
        fields: ['title', 'gauge', 'condition', 'shelf', 'inspectedAt', 'runtimeMinutes'],
      },
      screening: { label: 'Screening', fields: ['venue', 'startsAt', 'seatsSold'] },
    },
  });
}

describe('redactDiff', () => {
  it('keeps only allowlisted fields — unknown keys are dropped silently', () => {
    expect(
      redactDiff(archive(), 'reel', {
        condition: 'VINEGAR_SYNDROME',
        donorEmail: 'private@example.org',
        rawProvenanceBlob: '{secret}',
      }),
    ).toEqual({ condition: 'VINEGAR_SYNDROME' });
  });

  it('serializes Dates to ISO and drops nested values (a diff is flat)', () => {
    const inspectedAt = new Date('2026-07-24T12:00:00Z');
    expect(
      redactDiff(archive(), 'reel', {
        inspectedAt,
        condition: { nested: true },
        shelf: null,
        gauge: ['16mm'],
      }),
    ).toEqual({ inspectedAt: '2026-07-24T12:00:00.000Z', shelf: null });
  });

  it('returns an empty diff for an absent input', () => {
    expect(redactDiff(archive(), 'reel', undefined)).toEqual({});
  });

  it('keeps every field SEVERAL writers of one resource emit', () => {
    // The allowlist is deny-by-default PER RESOURCE TYPE, and two writers of the
    // same resource emit overlapping but different keys. A field only one of
    // them uses still has to be listed, or that writer's entries come back
    // hollow and the action name is the only thing the row says.
    const ingest = { title: 'Nanook', gauge: '35mm', runtimeMinutes: 79 };
    const inspection = { condition: 'STABLE', shelf: 'C-14', inspectedAt: null };
    expect(redactDiff(archive(), 'reel', ingest)).toEqual(ingest);
    expect(redactDiff(archive(), 'reel', inspection)).toEqual(inspection);
  });

  it('THROWS for an unknown resource type instead of writing a hollow row', () => {
    // A host adding a resource type it forgot to declare deserves to be told
    // which one, and inside the caller's transaction, so nothing lands.
    expect(() => redactDiff(archive(), 'poster', { title: 'x' })).toThrow(AuditVocabularyError);
    expect(() => redactDiff(archive(), 'poster', { title: 'x' })).toThrow(/poster/);
  });
});

describe('defineAuditVocabulary — the shape it hands back', () => {
  it('preserves declaration order on both axes', () => {
    // Order is part of the surface: the filter enum and the viewer's pills read
    // it, so re-ordering moves a published schema.
    const vocabulary = archive();
    expect([...vocabulary.actionIds]).toEqual([
      'reel.ingest',
      'reel.deaccession',
      'screening.schedule',
    ]);
    expect([...vocabulary.resourceIds]).toEqual(['reel', 'screening']);
  });

  it('narrows an untrusted value rather than assuming a string', () => {
    const vocabulary = archive();
    expect(vocabulary.hasAction('reel.ingest')).toBe(true);
    expect(vocabulary.hasAction('reel.INGEST')).toBe(false);
    expect(vocabulary.hasAction(null)).toBe(false);
    expect(vocabulary.hasAction(undefined)).toBe(false);
    expect(vocabulary.hasAction(42)).toBe(false);
    // Inherited object members are not vocabulary.
    expect(vocabulary.hasResource('constructor')).toBe(false);
    expect(vocabulary.hasResource('toString')).toBe(false);
  });

  it('falls back to the raw id when something unlabelled is asked for', () => {
    // Defensive on READ only: an entry written before an action was renamed
    // still renders, as its id, rather than as an empty cell. The write side
    // has no such leniency — a blank label is refused at assembly, below.
    const vocabulary = archive();
    expect(vocabulary.actionLabel('reel.ingest')).toBe('Reel ingested');
    expect(vocabulary.actionLabel('mystery.event')).toBe('mystery.event');
    expect(vocabulary.resourceLabel('reel')).toBe('Reel');
    expect(vocabulary.resourceLabel('mystery')).toBe('mystery');
  });

  it('is frozen, and hands out a frozen copy of each axis', () => {
    // A host that keeps a reference cannot widen the set a filter enum was
    // already built from while the write predicate follows along.
    const vocabulary = archive();
    expect(Object.isFrozen(vocabulary)).toBe(true);
    expect(Object.isFrozen(vocabulary.actionIds)).toBe(true);
    expect(Object.isFrozen(vocabulary.resourceIds)).toBe(true);
  });

  it('lets a host name its own unions off the declared ids', () => {
    const vocabulary = archive();
    type ArchiveAction = AuditActionOf<typeof vocabulary>;
    type ArchiveResource = AuditResourceOf<typeof vocabulary>;
    // The compiler is the assertion; the runtime lines keep the bindings used.
    const action: ArchiveAction = 'screening.schedule';
    const resource: ArchiveResource = 'screening';
    expect(vocabulary.hasAction(action)).toBe(true);
    expect(vocabulary.hasResource(resource)).toBe(true);
  });

  it('is the SAME object the write path and the read path both use', () => {
    // The property this is an object for: `actionIds` is what a host's filter
    // enum is built from and `hasAction` is what the writer validates against,
    // and both are derived from one frozen copy. A corpus, so "lenient" and
    // "strict" can differ about what happens to a rejected value but never
    // about which values are rejected.
    const vocabulary = archive();
    const corpus = [
      ...vocabulary.actionIds,
      'reel.ingest ',
      ' reel.ingest',
      'REEL.INGEST',
      '',
      'constructor',
      'reel.burn',
    ];
    const declared = new Set<string>(vocabulary.actionIds);
    for (const value of corpus) {
      expect(vocabulary.hasAction(value)).toBe(declared.has(value));
    }
  });
});

describe('defineAuditVocabulary — what it refuses at assembly', () => {
  // The field is matched as a PLAIN STRING, which `toThrow` already treats as
  // "the message contains this". It used to build a `RegExp` from an escape
  // that covered `[`, `]`, `"` and `.` — the metacharacters these field names
  // actually contain (`resources["thing"].fields`) — but not the backslash that
  // does the escaping, so a field carrying one would have produced a pattern
  // matching something else entirely. No field does today; the fix is to stop
  // building a pattern at all rather than to lengthen the character class.
  const refuse = (build: () => unknown, specField: string) => {
    expect(build).toThrow(AuditConfigError);
    expect(build).toThrow(specField);
  };

  it('refuses an empty actions map', () => {
    // Not a closed door: the writer then throws for EVERY action, inside each
    // caller's transaction, so the host's audited mutations roll back at
    // runtime while assembly stays green.
    refuse(
      () => defineAuditVocabulary({ actions: {}, resources: { a: { label: 'A', fields: ['x'] } } }),
      'actions',
    );
  });

  it('refuses an empty resources map', () => {
    refuse(
      () => defineAuditVocabulary({ actions: { 'a.b': { label: 'A' } }, resources: {} }),
      'resources',
    );
  });

  it('refuses an empty field allowlist — the deny-by-default fail-open', () => {
    // The resource is declared, so nothing throws, and every field of every
    // diff for it is dropped: the trail records that something changed without
    // recording what to, permanently, on an append-only table.
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { 'a.b': { label: 'A' } },
          resources: { thing: { label: 'Thing', fields: [] } },
        }),
      'resources["thing"].fields',
    );
  });

  it('refuses a blank label on either axis', () => {
    // Promoted from an assertion about one host's catalog: nine actions with no
    // label at all rendered a raw dotted id to an operator. No host can now get
    // it wrong, rather than one host having been checked.
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { 'a.b': { label: '  ' } },
          resources: { thing: { label: 'Thing', fields: ['x'] } },
        }),
      'actions["a.b"].label',
    );
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { 'a.b': { label: 'A' } },
          resources: { thing: { label: '', fields: ['x'] } },
        }),
      'resources["thing"].label',
    );
  });

  it('refuses a value with surrounding whitespace, on every axis', () => {
    // What `'a.b, c.d'.split(',')` produces, and the malformation whose every
    // consequence is silent.
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { ' a.b': { label: 'A' } },
          resources: { thing: { label: 'Thing', fields: ['x'] } },
        }),
      'actions',
    );
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { 'a.b': { label: 'A' } },
          resources: { thing: { label: 'Thing', fields: ['x '] } },
        }),
      'resources["thing"].fields',
    );
  });

  it('refuses a blank id and a blank field name', () => {
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { '': { label: 'A' } },
          resources: { thing: { label: 'Thing', fields: ['x'] } },
        }),
      'actions',
    );
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { 'a.b': { label: 'A' } },
          resources: { thing: { label: 'Thing', fields: [''] } },
        }),
      'resources["thing"].fields',
    );
  });

  it('refuses a duplicate field name', () => {
    // Two identical entries make "the allowlist widened" and "it did not"
    // produce the same length, which is what a drift test usually watches.
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { 'a.b': { label: 'A' } },
          resources: { thing: { label: 'Thing', fields: ['x', 'x'] } },
        }),
      'resources["thing"].fields',
    );
  });

  it('refuses an integer-like id, because a JS object would re-sort it', () => {
    // `Object.keys({ '10': …, alpha: … })` is `['10', 'alpha']` whatever order
    // they were written in — and declaration order is what the filter enum and
    // the viewer's pills publish.
    refuse(
      () =>
        defineAuditVocabulary({
          actions: { 'a.b': { label: 'A' } },
          resources: { '10': { label: 'Ten', fields: ['x'] }, thing: { label: 'T', fields: ['x'] } },
        }),
      'resources',
    );
  });

  it('refuses a spec whose axes are not maps at all', () => {
    refuse(
      () =>
        defineAuditVocabulary(
          // @ts-expect-error — the compiler refuses this too; the runtime guard
          // is what a host assembling from a settings table meets instead.
          { actions: [{ id: 'a.b', label: 'A' }], resources: { t: { label: 'T', fields: ['x'] } } },
        ),
      'actions',
    );
  });
});

describe('assertAuditVocabulary', () => {
  it('accepts what the factory returned', () => {
    const vocabulary = archive();
    expect(assertAuditVocabulary(vocabulary)).toBe(vocabulary);
  });

  it('refuses a hand-built object that never met a single refusal', () => {
    // `AuditVocabulary` is a published interface and its fields are erased at
    // runtime, so a host assembling one by hand — or restoring one through
    // `JSON.parse` of a cached config — would otherwise reach the writer with a
    // value none of the assembly guards ever saw.
    const lookalike = {
      actionIds: ['a.b'],
      resourceIds: ['thing'],
      hasAction: () => true,
      hasResource: () => true,
      allowlistFor: () => new Set<string>(),
      actionLabel: (id: string) => id,
      resourceLabel: (id: string) => id,
    };
    expect(() => assertAuditVocabulary(lookalike)).toThrow(AuditConfigError);
    expect(() => assertAuditVocabulary(undefined)).toThrow(/defineAuditVocabulary/);
    expect(() => assertAuditVocabulary(null)).toThrow(AuditConfigError);
  });

  it('names the config path it was asked about', () => {
    expect(() => assertAuditVocabulary(undefined, 'createWebAudit.vocabulary')).toThrow(
      /createWebAudit\.vocabulary/,
    );
  });
});

/**
 * The locale axis, and the line it deliberately stops at.
 *
 * An audit log is opened by whichever operator is looking, so a label follows
 * the REQUEST. The ids around it must not: they are what a writer persists, a
 * filter enum advertises and a parser matches on, so a vocabulary that varied
 * them per reader would validate a row for one operator and refuse it for the
 * next. The shape is what enforces that — these cases pin both halves.
 */
describe('vocabulary labels follow the reader', () => {
  /** A pack keyed by tag, resolved the way a host's `localeCopy` would. */
  const pack = (words: Record<string, string>) => {
    return ({ locale }: { readonly locale?: string | null }): string =>
      words[typeof locale === 'string' ? locale : ''] ?? words['pt-BR'] ?? '';
  };

  const bilingual = () =>
    defineAuditVocabulary({
      actions: {
        'reel.ingest': { label: pack({ 'pt-BR': 'Bobina recebida', 'en-US': 'Reel ingested' }) },
      },
      resources: {
        reel: { label: pack({ 'pt-BR': 'Bobina', 'en-US': 'Reel' }), fields: ['title'] },
      },
    });

  it('resolves each label for the reader that asked, per call', () => {
    const vocabulary = bilingual();
    expect(vocabulary.actionLabel('reel.ingest', { locale: 'pt-BR' })).toBe('Bobina recebida');
    expect(vocabulary.actionLabel('reel.ingest', { locale: 'en-US' })).toBe('Reel ingested');
    expect(vocabulary.resourceLabel('reel', { locale: 'en-US' })).toBe('Reel');
    // The SAME vocabulary answered both, so nothing was frozen at assembly.
    expect(vocabulary.actionLabel('reel.ingest', { locale: 'pt-BR' })).toBe('Bobina recebida');
  });

  it('treats an absent locale as "nobody said" and lets the host resolver decide', () => {
    // Not the same as asserting pt-BR: the package passes the empty context
    // through, and what that falls back to is the host resolver's own line.
    const vocabulary = bilingual();
    expect(vocabulary.actionLabel('reel.ingest')).toBe('Bobina recebida');
    expect(vocabulary.actionLabel('reel.ingest', {})).toBe('Bobina recebida');
    expect(vocabulary.actionLabel('reel.ingest', { locale: null })).toBe('Bobina recebida');
  });

  it('keeps every id, predicate and allowlist fixed across readers', () => {
    // Rule H, structurally: there is nowhere to hang a resolver on an id, so
    // this is the axis the copy port must never reach. If it ever did, a row
    // would validate for one operator and be refused for the next.
    const vocabulary = bilingual();
    expect(vocabulary.actionIds).toEqual(['reel.ingest']);
    expect(vocabulary.resourceIds).toEqual(['reel']);
    expect(vocabulary.hasAction('reel.ingest')).toBe(true);
    expect(vocabulary.hasResource('reel')).toBe(true);
    expect([...(vocabulary.allowlistFor('reel') ?? [])]).toEqual(['title']);
    // Reading every label in the other language changes none of it.
    vocabulary.actionLabel('reel.ingest', { locale: 'en-US' });
    vocabulary.resourceLabel('reel', { locale: 'en-US' });
    expect(vocabulary.actionIds).toEqual(['reel.ingest']);
    expect(vocabulary.hasAction('reel.ingest')).toBe(true);
    expect([...(vocabulary.allowlistFor('reel') ?? [])]).toEqual(['title']);
  });

  it('probes a resolver at ASSEMBLY, so a host whose lookup missed fails to boot', () => {
    // The same move `messagesOf` makes for the refusals: widening the type
    // must not turn assembly's refusals into "unless you pass a function".
    expect(() =>
      defineAuditVocabulary({
        actions: { 'reel.ingest': { label: () => '' } },
        resources: { reel: { label: 'Reel', fields: ['title'] } },
      }),
    ).toThrow(AuditConfigError);
    expect(() =>
      defineAuditVocabulary({
        actions: { 'reel.ingest': { label: 'Reel ingested' } },
        resources: { reel: { label: () => '   ', fields: ['title'] } },
      }),
    ).toThrow(AuditConfigError);
  });

  it('falls back to the id when one language of a pack is short a line', () => {
    // Assembly already probed, so reaching here means the pack has a hole for
    // THIS reader only. A raw dotted id in one cell beats a viewer that throws
    // mid-render and shows an operator no rows at all.
    const vocabulary = defineAuditVocabulary({
      actions: { 'reel.ingest': { label: pack({ 'pt-BR': 'Bobina recebida', 'en-US': '' }) } },
      resources: { reel: { label: 'Reel', fields: ['title'] } },
    });
    expect(vocabulary.actionLabel('reel.ingest', { locale: 'pt-BR' })).toBe('Bobina recebida');
    expect(vocabulary.actionLabel('reel.ingest', { locale: 'en-US' })).toBe('reel.ingest');
  });

  it('still takes a plain string, so a single-audience host changes nothing', () => {
    const vocabulary = defineAuditVocabulary({
      actions: { 'reel.ingest': { label: 'Reel ingested' } },
      resources: { reel: { label: 'Reel', fields: ['title'] } },
    });
    expect(vocabulary.actionLabel('reel.ingest', { locale: 'en-US' })).toBe('Reel ingested');
    expect(vocabulary.actionLabel('reel.ingest')).toBe('Reel ingested');
  });
});
