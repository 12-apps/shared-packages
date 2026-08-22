/**
 * Sidebar persistence for a shell's collapsible nav: which sections an operator
 * has collapsed, and whether the whole sidebar is reduced to an icon rail.
 *
 * Both live in ONE `localStorage` entry per key — `{ collapsed: string[], rail:
 * boolean }` — because they are one preference in the operator's head ("how my
 * nav is set up") and because two entries would have to be expired together.
 *
 * Three properties are load-bearing, and each one is a bug that was paid for
 * before it was written down:
 *
 *  - **`collapsed` stores the EXCEPTION, not the state.** Sections default to
 *    expanded, so an operator who has never touched the nav sees every
 *    destination — and a section added later appears open rather than
 *    inheriting some stale default from an entry written before it existed.
 *  - **Writes MERGE.** `rail` predates `collapsed` in the entries this shape
 *    was extracted from, so an entry can hold only one half. A replacing write
 *    would drop an operator's rail preference the first time they collapsed a
 *    section, and vice versa.
 *  - **The hooks re-key.** See {@link useCollapsedSections}.
 *
 * Every read is guarded: a corrupt entry (hand-edited, half-written, or written
 * by an older shape) reads as "no preference" rather than throwing inside a
 * render. Persistence is best-effort in the other direction too — a full or
 * disabled store must not break a nav.
 */
import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { alpha } from '@12-apps/ui/mui/styles';
import type { Theme } from '@12-apps/ui/mui/styles';

/**
 * The subtle primary tint that separates the sidebar panel from the content
 * beside it. A function of the theme, so it follows a tenant's brand colour and
 * both colour-scheme modes instead of being a second hard-coded grey.
 */
export const sidebarPanelBg = (t: Theme): string => alpha(t.palette.primary.main, 0.04);

/**
 * The `localStorage` key for one sidebar's state: `prefix` and every `segment`,
 * colon-joined.
 *
 * The `prefix` is the HOST's — `sidebarStorageKey('admin-sidebar', tenant,
 * user)` — because two shells of the same product on one origin share a
 * `localStorage` and must not share an entry. The segments are whatever scopes
 * the preference: a user, and a tenant too where the shell is tenant-scoped.
 *
 * Returns `null` when any segment is empty, and a `null` key disables
 * persistence throughout this module. That is the honest answer for a shell
 * rendered before its session resolves, or for an operator with no user row:
 * the alternative is an entry like `admin-sidebar::` that every such visitor
 * shares and then overwrites for the next one.
 */
export function sidebarStorageKey(prefix: string, ...segments: string[]): string | null {
  if (segments.length === 0 || segments.some((segment) => !segment)) return null;
  return [prefix, ...segments].join(':');
}

/** The persisted shape. Both halves are optional — an older entry has only `rail`. */
interface SidebarState {
  collapsed?: string[];
  rail?: boolean;
}

function readState(key: string | null): SidebarState {
  if (key === null || typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as Record<string, unknown>;
    const collapsed = Array.isArray(obj.collapsed)
      ? obj.collapsed.filter((v): v is string => typeof v === 'string')
      : undefined;
    return { collapsed, rail: obj.rail === true };
  } catch {
    return {};
  }
}

function writeState(key: string | null, next: SidebarState): void {
  if (key === null || typeof window === 'undefined') return;
  try {
    const current = readState(key);
    window.localStorage.setItem(key, JSON.stringify({ ...current, ...next }));
  } catch {
    /* persistence is best-effort */
  }
}

/**
 * Re-read `storeKey`'s entry during THIS render when the key changes, using
 * React's "adjust state when a prop changes" pattern rather than an effect.
 *
 * An effect would render the previous key's state once against the new key —
 * visible as the old tenant's sections flashing under the new tenant's nav, and
 * worse than visible if the operator toggles during that frame, because the
 * write then lands in the new key.
 */
function useRekeyed<T>(
  storeKey: string | null,
  read: (key: string | null) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => read(storeKey));
  const [loadedKey, setLoadedKey] = useState(storeKey);
  if (loadedKey !== storeKey) {
    setLoadedKey(storeKey);
    setValue(read(storeKey));
  }
  return [value, setValue];
}

/**
 * The persisted set of COLLAPSED section keys, and a toggle for one section.
 *
 * Keyed by `storeKey`: when the key changes the hook re-reads the new key's
 * entry, instead of carrying the previous one's sections over and later
 * overwriting the new key's saved preferences with them. Two things change a
 * key, and only the first is obvious — a tenant switcher swapping the tenant in
 * place, and a session RESOLVING, which turns a `null` key into a real one.
 * A shell whose key is null on first render and real on the second is the
 * common case, so a hook that read once would show a default nav to every
 * operator who has ever set one.
 */
export function useCollapsedSections(
  storeKey: string | null,
): [Set<string>, (key: string) => void] {
  const [collapsed, setCollapsed] = useRekeyed(
    storeKey,
    (key) => new Set(readState(key).collapsed ?? []),
  );

  const toggle = useCallback(
    (key: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        writeState(storeKey, { collapsed: [...next] });
        return next;
      });
    },
    [storeKey, setCollapsed],
  );

  return [collapsed, toggle];
}

/**
 * The persisted icon-rail flag (the whole sidebar collapsed to icons), and a
 * toggle for it. Re-keyed exactly like {@link useCollapsedSections}, so a key
 * change shows — and writes — the destination key's own preference.
 */
export function useSidebarRail(storeKey: string | null): [boolean, () => void] {
  const [rail, setRail] = useRekeyed(storeKey, (key) => readState(key).rail === true);

  const toggle = useCallback(() => {
    setRail((prev) => {
      const next = !prev;
      writeState(storeKey, { rail: next });
      return next;
    });
  }, [storeKey, setRail]);

  return [rail, toggle];
}
