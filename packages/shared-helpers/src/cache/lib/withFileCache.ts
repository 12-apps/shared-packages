import { promises as fs } from 'fs';
import * as path from 'path';

import { logger } from '../../utils/lib/logger';

interface FileCacheEntry<V> { value: V; expiresAt: number; }
interface FileCacheData<V> { entries: Record<string, FileCacheEntry<V>>; }

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PersistentCacheOptions<A extends any[], K, V> {
  getKey: (...args: A) => K | undefined | null;
  fetcher: (...args: A) => Promise<V>;
  ttlMs?: number;
  cacheDir?: string;
  fileName?: string;
  shouldCache?: (val: V) => boolean;
  onError?: (err: unknown, key: K) => void;
}

// One cache's mutable bookkeeping. It used to live in the factory closure, which
// made the factory a single 86-line function; passing it explicitly lets each
// operation below stand on its own.
interface FileCacheState<V> {
  cacheDir: string;
  filePath: string;
  ttlMs: number;
  data: FileCacheData<V>;
  loaded: boolean;
  dirty: boolean;
  flushTimer: NodeJS.Timeout | null;
}

// Writes to a sibling temp file and renames, so a crash mid-write leaves the
// previous cache intact rather than a truncated JSON file.
const flush = async <V>(state: FileCacheState<V>): Promise<void> => {
  state.flushTimer = null;
  if (!state.dirty) return;
  state.dirty = false;
  try {
    await fs.mkdir(state.cacheDir, { recursive: true });
    const tmp = `${state.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state.data, null, 2), 'utf8');
    await fs.rename(tmp, state.filePath);
  } catch {
    // Silently ignore file write errors
  }
};

const scheduleFlush = <V>(state: FileCacheState<V>): void => {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => void flush(state), 250);
};

const prune = <V>(state: FileCacheState<V>): void => {
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of Object.entries(state.data.entries)) {
    if (!entry || entry.expiresAt < now) {
      delete state.data.entries[key];
      changed = true;
    }
  }
  if (changed) {
    scheduleFlush(state);
  }
};

const load = async <V>(state: FileCacheState<V>): Promise<void> => {
  if (state.loaded) {
    return;
  }
  state.loaded = true;
  try {
    const parsed = JSON.parse(await fs.readFile(state.filePath, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.entries) {
      state.data = parsed;
    }
  } catch {
    logger.error(`Failure parsing cache ${state.filePath}`);
  }
  prune(state);
};

const set = <K extends string | number, V>(state: FileCacheState<V>, key: K, value: V): void => {
  state.data.entries[String(key)] = { value, expiresAt: Date.now() + state.ttlMs };
  state.dirty = true;
  scheduleFlush(state);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withFileCache<A extends any[], K extends string | number, V>(opts: PersistentCacheOptions<A, K, V>) {
  const cacheDir = opts.cacheDir ?? path.resolve(process.cwd(), '.cache');
  const state: FileCacheState<V> = {
    cacheDir,
    filePath: path.join(cacheDir, opts.fileName ?? 'persistent-cache.json'),
    ttlMs: opts.ttlMs ?? DEFAULT_TTL_MS,
    data: { entries: {} },
    loaded: false,
    dirty: false,
    flushTimer: null,
  };

  return async (...args: A): Promise<V | undefined> => {
    const key = opts.getKey(...args);
    if (key === undefined || key === null || key === '') {
      return undefined;
    }
    await load(state);
    prune(state);
    const entry = state.data.entries[String(key)];
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
    try {
      const val = await opts.fetcher(...args);
      if (opts.shouldCache ? opts.shouldCache(val) : true) set(state, key as K, val);
      return val;
    } catch (e) {
      opts.onError?.(e, key as K);
      throw e;
    }
  };
}
