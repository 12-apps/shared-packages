"use client";

/**
 * WHERE THE SCOPE TABS GO, AND WHEN THEY DO NOT GO THERE AT ALL.
 *
 * Its own module because it is a placement rule rather than a control: the
 * strip itself is `DataViewsScopeTabs`, and this decides whether the grid shows
 * one.
 */
import { DataViewsScopeTabs, type ScopeConfig } from "./data-views-scopes";
import { useDataViewsLayout } from "./data-views-layout-context";

/**
 * The scope tabs — BELOW the toolbar, and absent when the board is already
 * showing the same partition.
 *
 * A "Quadro" grouped by `situacao` is a column per situação; a scope strip over
 * the same field is a tab per situação. Together they are the same partition
 * offered twice, one of which silently narrows what the other displays —
 * picking the "Cancelado" tab leaves a board with one populated column and the
 * rest empty, which reads as data loss rather than as a filter.
 *
 * Only when they partition by the SAME field: a board grouped by one field
 * beside scopes over another are two different cuts, and both belong.
 */
export function ScopeTabsSlot({
  scopes,
  scopeFieldId,
  board,
  value,
  onChange,
  counts,
  testIdPrefix,
}: {
  scopes: ScopeConfig[];
  scopeFieldId?: string;
  board?: { groupBy: string };
  value?: string;
  onChange: (id: string) => void;
  counts?: Record<string, number>;
  testIdPrefix: string;
}): React.JSX.Element | null {
  const { layout } = useDataViewsLayout();
  const boardOwnsThisPartition =
    layout === "board" && Boolean(scopeFieldId) && scopeFieldId === board?.groupBy;
  if (boardOwnsThisPartition) return null;
  // Renders nothing (and reserves nothing) for an empty scope list.
  return (
    <DataViewsScopeTabs
      scopes={scopes}
      value={value}
      onChange={onChange}
      counts={counts}
      testIdPrefix={testIdPrefix}
    />
  );
}
