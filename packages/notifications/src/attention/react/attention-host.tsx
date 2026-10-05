/**
 * The attention button, mounted: it ranks what the host hands it, draws ONE
 * button for the next thing to do, a quiet "+N" for the rest, rings and buzzes
 * for news, and opens whatever the item's kind declares.
 *
 * The host composes it in one wiring file: the registry (`defineAttention`)
 * says how each kind is measured and ranked; the `views` say, per kind, its
 * glyph, how it is named, and what a tap opens — a sheet drawn here
 * (`renderSheet`), or anything else the host does itself (`onOpen`, e.g. a
 * navigation to the screen that already draws that sheet).
 *
 * It draws nothing while nothing waits — unless the host gives it the words of
 * the folded mode (`collapsed`, `./attention-collapsible`): then a thin tab on
 * the right edge is always there, and a tap opens the button.
 */
import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';

import {
  readAttention,
  worstSeverity,
  type AttentionEntry,
  type AttentionItem,
  type AttentionRegistry,
} from '../core';

import { useAttentionAlerts, type AttentionSounds } from './alerts';
import { AttentionButton, AttentionOthersButton } from './attention-button';
import {
  AttentionCollapseButton,
  AttentionEmptyNote,
  AttentionTab,
  useCollapse,
  type AttentionCollapsedMessages,
} from './attention-collapsible';
import { AttentionDock, type AttentionDockRest } from './attention-dock';
import { AttentionOthersList } from './attention-others-list';
import { iconOf, minutesOf, type AttentionKindView, type AttentionViews } from './views';
import type { AttentionMessages } from './messages';
import {
  useAttentionPreferences,
  type AttentionDockPosition,
  type AttentionPreferences,
  type AttentionPreferencesStore,
} from './preferences';

export interface AttentionHostProps {
  readonly registry: AttentionRegistry;
  readonly views: AttentionViews;
  readonly items: readonly AttentionItem[];
  /** The clock, in epoch ms — the host's tick, so every screen agrees on "now". */
  readonly now: number;
  readonly can?: (permission: string) => boolean;
  readonly messages: AttentionMessages;
  readonly preferences: AttentionPreferencesStore;
  readonly sounds?: AttentionSounds;
  /** The resting spot's distance from the foot of the screen (a CSS length). */
  readonly bottom?: string;
  readonly zIndex?: number;
  /** Where the dock rests until the reader moves it (`./attention-dock`). */
  readonly rest?: AttentionDockRest;
  /**
   * False while the host is still loading what waits. Readings taken then only
   * set the baseline, so what was already waiting when the page opened never
   * rings. Defaults to true.
   */
  readonly ready?: boolean;
  /**
   * The words of the folded mode. Given, the button rests folded into a tab on
   * the right edge, halfway down, at every width — always drawn, even with
   * nothing waiting — and a tap opens it (`./attention-collapsible`). Omitted,
   * nothing changes.
   */
  readonly collapsed?: AttentionCollapsedMessages;
}

/** Where the folded mode opens the button, and where the tab sits: halfway down the right edge. */
const FOLDED_REST: AttentionDockPosition = { side: 'right', y: 0.5 };

/**
 * What a tap opens: the kind's own `onOpen`, or its sheet drawn here. The
 * sheet stays only while its item is still waiting — done is done.
 */
function useOpenEntry(
  entries: readonly AttentionEntry[],
  views: AttentionViews,
  beforeOpen: () => void,
): {
  readonly open: (entry: AttentionEntry) => void;
  readonly sheet: ReactNode;
} {
  const [openId, setOpenId] = useState<string | null>(null);
  const stillWaiting = openId !== null && entries.some((entry) => entry.item.id === openId);
  // Done is done: forget the open item when it leaves, or an item that came
  // back later under the same id would reopen its sheet unasked.
  useEffect(() => {
    if (openId !== null && !stillWaiting) setOpenId(null);
  }, [openId, stillWaiting]);
  const open = (entry: AttentionEntry): void => {
    beforeOpen();
    const view = views[entry.kind.id];
    if (view?.onOpen !== undefined) {
      view.onOpen(entry.item);
      return;
    }
    setOpenId(entry.item.id);
  };
  const openEntry = openId === null ? undefined : entries.find((entry) => entry.item.id === openId);
  const sheet =
    openEntry === undefined
      ? null
      : (views[openEntry.kind.id]?.renderSheet?.({
          item: openEntry.item,
          close: () => setOpenId(null),
        }) ?? null);
  return { open, sheet };
}

/** The button read aloud: the next thing, how long it has waited, how many more. */
function buttonLabel(
  messages: AttentionMessages,
  view: AttentionKindView,
  head: AttentionEntry,
  waited: string,
  others: number,
): string {
  const named = view.describe(head.item);
  return messages.button({
    title: named.spoken ?? named.title,
    what: named.what,
    waited,
    urgent: head.severity !== 'calm',
    others,
  });
}

/** What waits, ranked — less the kinds this host has no view for, which it cannot draw or open. */
function useEntries(
  registry: AttentionRegistry,
  views: AttentionViews,
  items: readonly AttentionItem[],
  now: number,
  can: ((permission: string) => boolean) | undefined,
): readonly AttentionEntry[] {
  const reading = useMemo(() => readAttention(registry, items, { now, can }), [registry, items, now, can]);
  return useMemo(() => reading.entries.filter((entry) => views[entry.kind.id] !== undefined), [reading, views]);
}

/**
 * The element the others' list hangs off. Dropped once nothing else waits, or
 * once the button folds — or the next arrival would reopen the list unasked.
 */
function useListAnchor(
  hasOthers: boolean,
  shown: boolean,
): readonly [HTMLElement | null, (anchor: HTMLElement | null) => void] {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!hasOthers || !shown) setAnchor(null);
  }, [hasOthers, shown]);
  return [anchor, setAnchor];
}

/**
 * Where the dock sits and what a drag does with it. Unfolded hosts keep the
 * device's remembered spot; a folded host keeps the drag for THIS opening only,
 * so folding back always lands where the tab is.
 */
function useDockSpot(
  store: AttentionPreferencesStore,
  preferences: AttentionPreferences,
  folding: boolean,
): {
  readonly position: AttentionDockPosition | null;
  readonly onMove: (dock: AttentionDockPosition) => void;
  readonly reset: () => void;
  /** The side it rests on, for the list that hangs off it. */
  readonly side: 'left' | 'right';
  /** Where it rests until moved: the folded mode's spot, or the dock's own default. */
  readonly rest: AttentionDockRest | undefined;
} {
  const [spot, setSpot] = useState<AttentionDockPosition | null>(null);
  if (!folding) {
    return {
      position: preferences.dock,
      onMove: (dock) => store.write({ dock }),
      reset: () => undefined,
      side: preferences.dock?.side ?? 'right',
      rest: undefined,
    };
  }
  return {
    position: spot,
    onMove: setSpot,
    reset: () => setSpot(null),
    side: (spot ?? FOLDED_REST).side,
    rest: FOLDED_REST,
  };
}

export function AttentionHost({
  registry,
  views,
  items,
  now,
  can,
  messages,
  preferences: store,
  sounds,
  bottom,
  zIndex = 1200,
  rest,
  ready = true,
  collapsed,
}: AttentionHostProps): JSX.Element | null {
  const preferences = useAttentionPreferences(store);
  const entries = useEntries(registry, views, items, now, can);
  // News rings and buzzes whether the button is folded or not.
  useAttentionAlerts(entries, preferences, sounds, ready);
  const fold = useCollapse(entries.length);
  const [listAnchor, setListAnchor] = useListAnchor(entries.length > 1, collapsed === undefined || fold.open);
  const { open, sheet } = useOpenEntry(entries, views, () => setListAnchor(null));
  const dock = useDockSpot(store, preferences, collapsed !== undefined);

  if (entries.length === 0 && collapsed === undefined) return sheet === null ? null : <>{sheet}</>;
  const folded = collapsed !== undefined && !fold.open;
  return (
    <>
      {folded ? (
        <FoldedTab
          entries={entries}
          words={collapsed}
          zIndex={zIndex}
          onExpand={() => {
            dock.reset();
            fold.expand();
          }}
        />
      ) : (
        <>
          <AttentionDock position={dock.position} onMove={dock.onMove} bottom={bottom} zIndex={zIndex} rest={rest ?? dock.rest}>
            <DockContents
              entries={entries}
              views={views}
              messages={messages}
              words={collapsed}
              listOpen={listAnchor !== null}
              onCollapse={fold.collapse}
              onOthers={setListAnchor}
              onOpen={open}
            />
          </AttentionDock>
          <AttentionOthersList
            anchor={listAnchor}
            side={dock.side}
            entries={entries.slice(1)}
            views={views}
            messages={messages}
            onClose={() => setListAnchor(null)}
            onPick={open}
          />
        </>
      )}
      {/* One place, folded or not: folding never remounts an open sheet. */}
      {sheet}
    </>
  );
}

/** The folded button: the tab, with the count and the worst of what waits. */
function FoldedTab({
  entries,
  words,
  zIndex,
  onExpand,
}: {
  readonly entries: readonly AttentionEntry[];
  readonly words: AttentionCollapsedMessages;
  readonly zIndex: number;
  readonly onExpand: () => void;
}): JSX.Element {
  const worst = worstSeverity(entries.map((entry) => entry.severity));
  return (
    <AttentionTab
      count={entries.length}
      worst={worst}
      label={words.tab(entries.length, worst)}
      zIndex={zIndex}
      onExpand={onExpand}
    />
  );
}

/**
 * What the dock holds, from the inner edge outwards: the folded mode's "−"
 * (and its "nothing to see"), the "+N", then the button.
 */
function DockContents({
  entries,
  views,
  messages,
  words,
  listOpen,
  onCollapse,
  onOthers,
  onOpen,
}: {
  readonly entries: readonly AttentionEntry[];
  readonly views: AttentionViews;
  readonly messages: AttentionMessages;
  readonly words: AttentionCollapsedMessages | undefined;
  readonly listOpen: boolean;
  readonly onCollapse: () => void;
  readonly onOthers: (anchor: HTMLElement) => void;
  readonly onOpen: (entry: AttentionEntry) => void;
}): JSX.Element {
  const [head, ...others] = entries;
  const othersSeverity = worstSeverity(others.map((entry) => entry.severity)) ?? 'calm';
  return (
    <>
      {words !== undefined && <AttentionCollapseButton label={words.collapse} onCollapse={onCollapse} />}
      {words !== undefined && head === undefined && <AttentionEmptyNote text={words.empty} />}
      {others.length > 0 && (
        <AttentionOthersButton
          count={others.length}
          severity={othersSeverity}
          label={messages.others(others.length, othersSeverity)}
          expanded={listOpen}
          // The list hangs off the whole dock, so it never covers the button.
          onClick={(ball) => onOthers(ball.closest<HTMLElement>('[data-testid="attention-dock"]') ?? ball)}
        />
      )}
      {head !== undefined && (
        <HeadButton head={head} others={others.length} views={views} messages={messages} onOpen={onOpen} />
      )}
    </>
  );
}

/** The round button for the next thing to do. */
function HeadButton({
  head,
  others,
  views,
  messages,
  onOpen,
}: {
  readonly head: AttentionEntry;
  readonly others: number;
  readonly views: AttentionViews;
  readonly messages: AttentionMessages;
  readonly onOpen: (entry: AttentionEntry) => void;
}): JSX.Element {
  const headView = views[head.kind.id] as AttentionKindView;
  const waited = messages.waited(minutesOf(head.waitedMs), head.waitedMs);
  return (
    <AttentionButton
      entry={head}
      icon={iconOf(headView, head.item)}
      waited={waited}
      label={buttonLabel(messages, headView, head, waited, others)}
      onOpen={() => onOpen(head)}
    />
  );
}
