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
 * It draws nothing while nothing waits.
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
import { AttentionDock } from './attention-dock';
import { AttentionOthersList } from './attention-others-list';
import { iconOf, minutesOf, type AttentionKindView, type AttentionViews } from './views';
import type { AttentionMessages } from './messages';
import { useAttentionPreferences, type AttentionPreferencesStore } from './preferences';

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
  /**
   * False while the host is still loading what waits. Readings taken then only
   * set the baseline, so what was already waiting when the page opened never
   * rings. Defaults to true.
   */
  readonly ready?: boolean;
}

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
  zIndex,
  ready = true,
}: AttentionHostProps): JSX.Element | null {
  const preferences = useAttentionPreferences(store);
  const reading = useMemo(() => readAttention(registry, items, { now, can }), [registry, items, now, can]);
  // A kind with no view cannot be drawn or opened: it never reaches the button.
  const entries = useMemo(
    () => reading.entries.filter((entry) => views[entry.kind.id] !== undefined),
    [reading, views],
  );
  useAttentionAlerts(entries, preferences, sounds, ready);

  const [listAnchor, setListAnchor] = useState<HTMLElement | null>(null);
  const { open, sheet } = useOpenEntry(entries, views, () => setListAnchor(null));

  const [head, ...others] = entries;
  // The "+N" the list hangs off is gone once nothing else waits: drop the
  // anchor with it, or the next arrival would reopen the list unasked.
  const hasOthers = others.length > 0;
  useEffect(() => {
    if (!hasOthers) setListAnchor(null);
  }, [hasOthers]);
  if (head === undefined) return sheet === null ? null : <>{sheet}</>;
  const headView = views[head.kind.id] as AttentionKindView;
  const named = headView.describe(head.item);
  const waited = messages.waited(minutesOf(head.waitedMs));
  const othersSeverity = worstSeverity(others.map((entry) => entry.severity)) ?? 'calm';

  return (
    <>
      <AttentionDock
        position={preferences.dock}
        onMove={(dock) => store.write({ dock })}
        bottom={bottom}
        zIndex={zIndex}
      >
        {others.length > 0 && (
          <AttentionOthersButton
            count={others.length}
            severity={othersSeverity}
            label={messages.others(others.length, othersSeverity)}
            expanded={listAnchor !== null}
            onClick={setListAnchor}
          />
        )}
        <AttentionButton
          entry={head}
          icon={iconOf(headView, head.item)}
          waited={waited}
          label={messages.button({
            title: named.spoken ?? named.title,
            what: named.what,
            waited,
            urgent: head.severity !== 'calm',
            others: others.length,
          })}
          onOpen={() => open(head)}
        />
      </AttentionDock>
      <AttentionOthersList
        anchor={listAnchor}
        entries={others}
        views={views}
        messages={messages}
        onClose={() => setListAnchor(null)}
        onPick={open}
      />
      {sheet}
    </>
  );
}
