import { describe, expect, it } from 'vitest';

import {
  AttentionWiringError,
  announcementBetween,
  attentionKind,
  channelWants,
  defineAttention,
  pulseOf,
  readAttention,
  severityOfLap,
  snapshotOf,
  type AttentionItem,
} from '../core';

const MIN = 60_000;
const NOW = Date.parse('2026-10-02T20:00:00.000Z');
const ago = (minutes: number): number => NOW - minutes * MIN;

interface TableItem extends AttentionItem {
  readonly table: string;
}

const registry = defineAttention({
  categories: ['floor', 'kitchen', 'delivery'],
  kinds: [
    attentionKind<TableItem>({
      id: 'plates',
      category: 'floor',
      budgetMs: 5 * MIN,
      permission: 'floor:read',
    }),
    attentionKind<TableItem>({
      id: 'call',
      category: 'floor',
      budgetMs: 5 * MIN,
      permission: 'floor:read',
    }),
    attentionKind({
      id: 'ticket',
      category: 'kitchen',
      budgetMs: 10 * MIN,
      permission: 'kitchen:read',
    }),
    attentionKind({
      id: 'courier-waiting',
      category: 'delivery',
      budgetMs: 3 * MIN,
      // Urgent from the moment the courier is at the door.
      severity: () => 'late',
    }),
  ],
});

const item = (id: string, kind: string, minutes: number): TableItem => ({
  id,
  kind,
  since: ago(minutes),
  table: id,
});

const order = (items: readonly AttentionItem[], can?: (p: string) => boolean): string[] =>
  readAttention(registry, items, { now: NOW, can }).entries.map((entry) => entry.item.id);

describe('defineAttention', () => {
  it('refuses a kind naming an unlisted category', () => {
    expect(() =>
      defineAttention({
        categories: ['floor'],
        kinds: [{ id: 'x', category: 'bar', budgetMs: MIN }],
      }),
    ).toThrow(AttentionWiringError);
  });

  it('refuses a kind declared twice, a category listed twice and a budget of zero', () => {
    expect(() =>
      defineAttention({
        categories: ['floor'],
        kinds: [
          { id: 'x', category: 'floor', budgetMs: MIN },
          { id: 'x', category: 'floor', budgetMs: MIN },
        ],
      }),
    ).toThrow(/twice/);
    expect(() => defineAttention({ categories: ['a', 'a'], kinds: [] })).toThrow(/twice/);
    expect(() =>
      defineAttention({
        categories: ['a'],
        kinds: [{ id: 'x', category: 'a', budgetMs: 0 }],
      }),
    ).toThrow(/above zero/);
  });
});

describe('the severity ladder', () => {
  it('is calm under one lap, late from one, spent from two', () => {
    expect(severityOfLap(0.99)).toBe('calm');
    expect(severityOfLap(1)).toBe('late');
    expect(severityOfLap(1.99)).toBe('late');
    expect(severityOfLap(2)).toBe('spent');
  });

  it('lets a kind state its own conditions', () => {
    const [entry] = readAttention(registry, [item('d1', 'courier-waiting', 0)], { now: NOW }).entries;
    expect(entry?.severity).toBe('late');
  });

  it('draws the first lap while calm, the second while late, and a full ring once spent', () => {
    const [calm, late, spent] = ['a', 'b', 'c'].map(
      (id, index) =>
        readAttention(registry, [item(id, 'plates', [2, 7, 11][index] ?? 0)], {
          now: NOW,
        }).head,
    );
    expect(calm?.progress).toBeCloseTo(0.4);
    expect(late?.progress).toBeCloseTo(0.4);
    expect(spent?.progress).toBe(1);
  });
});

describe('the order of the queue', () => {
  it('puts severity first, whatever the category', () => {
    // A fresh plate (floor, the first category) after a late kitchen ticket.
    expect(order([item('p', 'plates', 1), item('t', 'ticket', 12)])).toEqual(['t', 'p']);
  });

  it('breaks a severity tie on the category order, then the kind order, then the longest wait', () => {
    expect(
      order([item('t', 'ticket', 2), item('c', 'call', 4), item('p1', 'plates', 1), item('p2', 'plates', 3)]),
    ).toEqual(['p2', 'p1', 'c', 't']);
  });

  it('puts spent before late', () => {
    expect(order([item('late', 'plates', 7), item('spent', 'ticket', 25)])).toEqual(['spent', 'late']);
  });

  it('shows only the kinds the reader may see, and drops undeclared kinds', () => {
    const items = [item('p', 'plates', 1), item('t', 'ticket', 1), item('?', 'unknown', 1)];
    expect(order(items, (permission) => permission === 'kitchen:read')).toEqual(['t']);
  });

  it('names the head, the rest, and the worst of the rest', () => {
    const reading = readAttention(
      registry,
      [item('a', 'plates', 7), item('b', 'call', 1), item('c', 'ticket', 25)],
      {
        now: NOW,
      },
    );
    expect(reading.head?.item.id).toBe('c');
    expect(reading.others.map((entry) => entry.item.id)).toEqual(['a', 'b']);
    expect(reading.othersSeverity).toBe('late');
  });

  it('is empty when nothing waits', () => {
    const reading = readAttention(registry, [], { now: NOW });
    expect(reading.head).toBeNull();
    expect(reading.othersSeverity).toBeNull();
  });
});

describe('how hard the button asks', () => {
  it('is still under 40%, soft to 70%, strong from 70% and while late, different once spent', () => {
    expect(pulseOf({ severity: 'calm', progress: 0.2 })).toBe('still');
    expect(pulseOf({ severity: 'calm', progress: 0.4 })).toBe('soft');
    expect(pulseOf({ severity: 'calm', progress: 0.7 })).toBe('strong');
    expect(pulseOf({ severity: 'late', progress: 0.1 })).toBe('strong');
    expect(pulseOf({ severity: 'spent', progress: 1 })).toBe('spent');
  });
});

describe('what is news', () => {
  it('announces an arrival and an escalation, the louder of them', () => {
    const before = snapshotOf(readAttention(registry, [item('a', 'plates', 1)], { now: NOW }).entries);
    const after = readAttention(registry, [item('a', 'plates', 7), item('b', 'call', 1)], {
      now: NOW,
    }).entries;
    expect(announcementBetween(before, after)?.item.id).toBe('a');
  });

  it('announces nothing for an item that merely stayed or calmed down', () => {
    const before = snapshotOf(readAttention(registry, [item('a', 'plates', 7)], { now: NOW }).entries);
    const after = readAttention(registry, [item('a', 'plates', 8)], {
      now: NOW,
    }).entries;
    expect(announcementBetween(before, after)).toBeNull();
  });
});

describe('a channel level', () => {
  it('fires never, for urgent items only, or for everything', () => {
    expect(channelWants('off', 'spent')).toBe(false);
    expect(channelWants('late', 'calm')).toBe(false);
    expect(channelWants('late', 'late')).toBe(true);
    expect(channelWants('all', 'calm')).toBe(true);
  });
});
