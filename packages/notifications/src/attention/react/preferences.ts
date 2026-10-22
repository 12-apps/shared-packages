/**
 * The attention button's settings, kept PER DEVICE.
 *
 * The counter tablet beeps and the waiter's own phone does not, and the push
 * subscription each of them holds is already per device — so the choices ride
 * the device too. Stored in `localStorage` under a key the host names, read
 * through `useSyncExternalStore` so every mounted control agrees at once.
 *
 * Storage can THROW (a private window, blocked site data) or come back empty;
 * every access is wrapped, and the defaults stand in.
 */
import { useSyncExternalStore } from 'react';

import type { AttentionChannelLevel } from '../core';

/** Where the button was dragged to: a side, and a height as a share of the screen. */
export interface AttentionDockPosition {
  readonly side: 'left' | 'right';
  /** 0 = the top of the screen, 1 = the bottom. */
  readonly y: number;
  /**
   * Set only where the reader let the folded tab go AWAY from an edge: how far
   * across, as a share of the screen (0 = the left edge, 1 = the right). Absent,
   * it is flush with `side`.
   */
  readonly x?: number;
}

export interface AttentionPreferences {
  readonly sound: AttentionChannelLevel;
  readonly vibration: AttentionChannelLevel;
  readonly push: AttentionChannelLevel;
  /** `null` until the reader drags the button somewhere. */
  readonly dock: AttentionDockPosition | null;
  /**
   * Where the reader dragged the FOLDED tab — its own key, so a spot the open
   * button was dragged to before the tab could move is never read as the tab's.
   * Absent or `null` until the tab is dragged.
   */
  readonly tab?: AttentionDockPosition | null;
}

export interface AttentionPreferencesStore {
  read(): AttentionPreferences;
  /** What a device that never chose reads — the server's snapshot, so hydration matches. */
  readDefaults(): AttentionPreferences;
  write(patch: Partial<AttentionPreferences>): void;
  subscribe(listener: () => void): () => void;
}

const LEVELS: readonly AttentionChannelLevel[] = ['off', 'late', 'all'];

const FALLBACK: AttentionPreferences = {
  sound: 'off',
  vibration: 'off',
  push: 'off',
  dock: null,
};

function levelOr(value: unknown, fallback: AttentionChannelLevel): AttentionChannelLevel {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
    ? (value as AttentionChannelLevel)
    : fallback;
}

function dockOr(value: unknown): AttentionDockPosition | null {
  if (typeof value !== 'object' || value === null) return null;
  const { side, y, x } = value as { side?: unknown; y?: unknown; x?: unknown };
  if ((side !== 'left' && side !== 'right') || typeof y !== 'number' || !Number.isFinite(y)) return null;
  const share = (n: number): number => Math.min(1, Math.max(0, n));
  return typeof x === 'number' && Number.isFinite(x) ? { side, y: share(y), x: share(x) } : { side, y: share(y) };
}

function tabOr(value: unknown): { readonly tab?: AttentionDockPosition } {
  const tab = dockOr(value);
  return tab === null ? {} : { tab };
}

function parse(raw: string | null, defaults: AttentionPreferences): AttentionPreferences {
  if (raw === null) return defaults;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      sound: levelOr(value.sound, defaults.sound),
      vibration: levelOr(value.vibration, defaults.vibration),
      push: levelOr(value.push, defaults.push),
      dock: dockOr(value.dock),
      // Only once the tab was dragged: a device that never did reads what it always read.
      ...tabOr(value.tab),
    };
  } catch {
    return defaults;
  }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * One store per key. `defaults` is what a device that never chose reads —
 * the host's call, since an adopter might want the counter tablet to ring out
 * of the box.
 */
export function createAttentionPreferences(options: {
  readonly storageKey: string;
  readonly defaults?: Partial<Omit<AttentionPreferences, 'dock' | 'tab'>>;
}): AttentionPreferencesStore {
  const defaults: AttentionPreferences = {
    ...FALLBACK,
    ...options.defaults,
    dock: null,
  };
  const listeners = new Set<() => void>();
  let cachedRaw: string | null | undefined;
  let cached: AttentionPreferences = defaults;
  // What this page chose when storage refused it (a full quota, blocked site
  // data): it wins over whatever storage still holds, for this page, and just
  // does not outlive the tab.
  let unsaved: string | null = null;

  const read = (): AttentionPreferences => {
    let raw: string | null = unsaved;
    if (raw === null) {
      try {
        raw = storage()?.getItem(options.storageKey) ?? null;
      } catch {
        raw = null;
      }
    }
    // The same object while nothing changed, or `useSyncExternalStore` loops.
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = parse(raw, defaults);
    }
    return cached;
  };

  return {
    read,
    readDefaults: () => defaults,
    write(patch) {
      const next = JSON.stringify({ ...read(), ...patch });
      // Not stored — no storage at all (blocked site data), or a refused write
      // (a full quota, where an OLDER value would otherwise win the next read).
      try {
        const target = storage();
        if (target === null) throw new Error('no storage');
        target.setItem(options.storageKey, next);
        unsaved = null;
      } catch {
        unsaved = next;
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent): void => {
        if (event.key === options.storageKey) listener();
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
  };
}

export function useAttentionPreferences(store: AttentionPreferencesStore): AttentionPreferences {
  return useSyncExternalStore(store.subscribe, store.read, store.readDefaults);
}
