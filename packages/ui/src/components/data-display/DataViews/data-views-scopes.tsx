"use client";

import { useEffect, useMemo, useRef } from "react";

import { Box } from "../../../mui/Box";

/**
 * SCOPES — a page-level partition rendered as a strip of tabs above the toolbar.
 *
 * A scope is not a filter. Filters NARROW within the current partition and are
 * multi-select by design; a scope PARTITIONS and is exclusive. The distinction
 * is load-bearing for three reasons, and each is why `FilterFieldConfig` could
 * not express these tabs:
 *
 *   1. They are mutually exclusive, and a pill is not.
 *   2. They carry counts of the WHOLE query, which no client can compute under
 *      pagination — the count has to come off the response
 *      ({@link DataViewServer.scopeCounts}).
 *   3. They compose with the filters instead of competing with them: the scope
 *      picks the bucket, the pills narrow inside it.
 *
 * The `predicate` is deliberately opaque to this package. Only the host knows
 * what "recusados" selects; the component's whole job is to say WHICH scope is
 * active and let the server answer.
 */
export interface ScopeConfig {
  /** Stable id — travels in `DataViewQuery.scope` and in a saved view's state. */
  id: string;
  label: string;
  /**
   * Opaque payload the SERVER interprets. Omitted on the "all" scope. Never read
   * by this package: a scope is applied at the backend, never in the browser.
   */
  predicate?: unknown;
}

/**
 * The active scope id, resolved against what the table currently declares.
 *
 * Resolution happens at READ time, on purpose. A saved view is written once and
 * read many times, and the declared scopes change underneath it — a scope
 * removed after a view was saved must fall back at render rather than break the
 * view or, worse, emit a scope the backend rejects. Resolving on write would
 * bake the mistake in.
 *
 * Returns `undefined` when the table declares no scopes, which is what keeps
 * `scope` out of the emitted query entirely for every table that never opted in.
 */
export function resolveScope(scopes: ScopeConfig[], stored: string | undefined): string | undefined {
  if (scopes.length === 0) return undefined;
  const declared = stored !== undefined && scopes.some((scope) => scope.id === stored);
  return declared ? stored : scopes[0]?.id;
}

/** Are we running outside production? Config mistakes fail loudly only here. */
function isDevelopment(): boolean {
  return typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
}

/**
 * Reject a table that partitions by a field AND declares a filter pill over the
 * same field. Two controls over one field is how a tab and a pill end up
 * contradicting each other — the pill says "estado ∈ {pago, recusado}" while the
 * tab says "estado = recusado", and nothing in either control can show the user
 * which one the server honoured.
 *
 * Throws in DEVELOPMENT ONLY. A thrown config error in production is strictly
 * worse than a duplicated control: the duplicate is confusing, the throw is a
 * blank page. Fail where it is seen and fixed.
 *
 * `scopeFieldId` is the field the scopes partition by, when the host knows it.
 * Absent, the scope IDS are checked against the field ids — which catches the
 * common shape where the scope ids ARE the field's values (`pago`, `recusado`)
 * declared a second time as a pill.
 */
export function assertNoScopePillOverlap(
  scopes: ScopeConfig[],
  fieldIds: string[],
  scopeFieldId?: string,
): void {
  if (scopes.length === 0 || !isDevelopment()) return;
  const clash = scopeFieldId !== undefined && fieldIds.includes(scopeFieldId) ? scopeFieldId : undefined;
  if (clash === undefined) return;
  throw new Error(
    `DataViews: the field "${clash}" is both the scope partition (scopes: ` +
      `${scopes.map((scope) => scope.id).join(", ")}) and a filter field (fields: ` +
      `${fieldIds.join(", ")}). A field may drive the scope tabs or a filter pill, not both — ` +
      `drop one of the two declarations.`,
  );
}

/**
 * A development-only warning that scopes need server wiring. Scopes are resolved
 * and emitted, never applied in the browser: filtering locally would make the
 * counts, the "N de N" counter and the rendered rows disagree the moment a
 * second page exists.
 */
export function warnScopesNeedServer(scopes: ScopeConfig[], hasServer: boolean): void {
  if (scopes.length === 0 || hasServer || !isDevelopment()) return;
  // eslint-disable-next-line no-console -- a config warning has no other channel.
  console.warn(
    "DataViews: `scopes` require server mode. The scope is tracked and would be emitted, " +
      "but with no `server` there is nothing to emit it to and rows are NOT filtered in the browser. " +
      "Supply `server` (see DataViewServer) or drop the scopes.",
  );
}

/**
 * The scope configuration's setup-time checks, run once per configuration rather
 * than per render: reject a field that is both a scope partition and a filter
 * pill (development only — see `assertNoScopePillOverlap`), and warn about
 * scopes declared with no server to apply them.
 *
 * In a `useMemo` so a mistake surfaces during the FIRST render, where the stack
 * still points at the table that made it.
 */
export function useScopeConfigChecks(
  scopes: ScopeConfig[],
  fieldIds: string[],
  scopeFieldId: string | undefined,
  hasServer: boolean,
): void {
  useMemo(() => {
    assertNoScopePillOverlap(scopes, fieldIds, scopeFieldId);
    warnScopesNeedServer(scopes, hasServer);
    // Keyed on the ids rather than the arrays: hosts pass inline literals, so the
    // array identity changes every render while the configuration does not.
  }, [scopes, fieldIds.join(","), scopeFieldId, hasServer]);
}

/** Everything the tab strip needs; `counts` is absent when the server omits it. */
interface DataViewsScopeTabsProps {
  scopes: ScopeConfig[];
  /** The RESOLVED active scope id (see {@link resolveScope}). */
  value: string | undefined;
  onChange: (id: string) => void;
  /** Server-supplied per-scope totals. Absent ⇒ tabs render WITHOUT numbers. */
  counts?: Record<string, number>;
  testIdPrefix: string;
}

/** The accessible name of one tab: its label, plus its count when there is one. */
function tabLabel(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label}, ${count}`;
}

/**
 * Move focus + selection between tabs with the arrow keys, wrapping at both
 * ends. Selection FOLLOWS focus here (an "automatic activation" tab list): each
 * arrow press is one scope change, which is one query — the same cost as a
 * click, and it keeps the strip's behaviour identical whichever input the
 * operator uses.
 */
function arrowTarget(key: string, index: number, total: number): number | null {
  if (key === "ArrowRight") return (index + 1) % total;
  if (key === "ArrowLeft") return (index - 1 + total) % total;
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  return null;
}

/** The active tab's own scroll-into-view, so a deep link to a late scope lands visible. */
function useScrollActiveIntoView(value: string | undefined): React.RefObject<HTMLDivElement | null> {
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || value === undefined) return;
    const active = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    // jsdom implements neither, so guard rather than assume the DOM is a browser's.
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);
  return stripRef;
}

/** One tab's visual + a11y state, kept out of the strip's map for readability. */
function scopeTabSx(active: boolean): Record<string, unknown> {
  return {
    // A 44px min target: the strip is the first thing a thumb reaches on a phone.
    minHeight: 44,
    px: 1.5,
    py: 1,
    border: 0,
    borderBottom: 2,
    borderStyle: "solid",
    borderColor: active ? "primary.main" : "transparent",
    background: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    font: "inherit",
    fontSize: "0.8125rem",
    fontWeight: active ? 600 : 400,
    color: active ? "primary.main" : "text.secondary",
    "&:hover": { color: active ? "primary.main" : "text.primary" },
    "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
  };
}

/** The count badge. Rendered only when the server actually supplied a number. */
function ScopeCount({
  count,
  active,
  testId,
}: {
  count: number;
  active: boolean;
  testId: string;
}): React.JSX.Element {
  return (
    <Box
      component="span"
      // The number is already in the tab's `aria-label`; announcing it twice
      // would read "Recusados 2, 2".
      aria-hidden="true"
      data-testid={testId}
      sx={{
        ml: 0.75,
        px: 0.75,
        borderRadius: 5,
        fontSize: "0.6875rem",
        fontWeight: 600,
        bgcolor: active ? "primary.main" : "action.selected",
        color: active ? "primary.contrastText" : "text.secondary",
      }}
    >
      {count}
    </Box>
  );
}

interface ScopeTabProps {
  scope: ScopeConfig;
  index: number;
  total: number;
  active: boolean;
  count: number | undefined;
  onChange: (id: string) => void;
  /**
   * Move to the tab at `index`: focus it AND select it. Only the strip knows
   * the other scopes and owns the DOM, so the move belongs to it.
   */
  moveTo: (index: number) => void;
  testIdPrefix: string;
}

/** One tab: a real `<button role="tab">` with a roving tabindex and arrow keys. */
function ScopeTab({
  scope,
  index,
  total,
  active,
  count,
  onChange,
  moveTo,
  testIdPrefix,
}: ScopeTabProps): React.JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      role="tab"
      id={`${testIdPrefix}-scope-tab-${scope.id}`}
      aria-selected={active}
      // Roving tabindex: one tab stop for the whole strip, arrows move within it.
      tabIndex={active ? 0 : -1}
      aria-label={tabLabel(scope.label, count)}
      data-testid={`${testIdPrefix}-scope-${scope.id}`}
      onClick={() => onChange(scope.id)}
      onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
        const target = arrowTarget(event.key, index, total);
        if (target === null) return;
        event.preventDefault();
        moveTo(target);
      }}
      sx={scopeTabSx(active)}
    >
      {scope.label}
      {count !== undefined && (
        <ScopeCount
          count={count}
          active={active}
          testId={`${testIdPrefix}-scope-count-${scope.id}`}
        />
      )}
    </Box>
  );
}

/** The strip's own layout: one non-wrapping row that scrolls horizontally. */
const STRIP_SX = {
  display: "flex",
  alignItems: "stretch",
  gap: 0.5,
  // One row that scrolls — never wraps, never collapses into a select.
  flexWrap: "nowrap",
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "thin",
  borderBottom: 1,
  borderColor: "divider",
  mx: { xs: -2, md: -3 },
  px: { xs: 2, md: 3 },
} as const;

/**
 * The scope strip: a horizontally scrolling tab list above the toolbar.
 *
 * It SCROLLS rather than collapsing into a select on a narrow screen, which is
 * the opposite of what the filter pills do — and deliberately. The counts are
 * the reason the tabs exist at all; burying them behind a menu costs a tap per
 * glance, exactly on the device where glancing is the point.
 *
 * Counts render verbatim from `counts` — never derived from the loaded page, and
 * never invented when the key is missing. A missing count means "the server did
 * not say", which reads honestly as no badge at all.
 */
export function DataViewsScopeTabs({
  scopes,
  value,
  onChange,
  counts,
  testIdPrefix,
}: DataViewsScopeTabsProps): React.JSX.Element | null {
  const stripRef = useScrollActiveIntoView(value);
  const moveTo = (index: number): void => {
    // Focus FIRST, then select: the roving tabindex follows the selection, so
    // focusing afterwards would land on a tab that has given up its tab stop.
    stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')?.[index]?.focus();
    const next = scopes[index];
    if (next) onChange(next.id);
  };
  // Reserve NO vertical space when there is nothing to show: a page that
  // declares no scopes must not gain an empty row.
  if (scopes.length === 0) return null;
  const activeIndex = Math.max(
    0,
    scopes.findIndex((scope) => scope.id === value),
  );

  return (
    <Box ref={stripRef} role="tablist" aria-label="Situação" data-testid={`${testIdPrefix}-scopes`} sx={STRIP_SX}>
      {scopes.map((scope, index) => (
        <ScopeTab
          key={scope.id}
          scope={scope}
          index={index}
          total={scopes.length}
          active={index === activeIndex}
          count={counts?.[scope.id]}
          onChange={onChange}
          moveTo={moveTo}
          testIdPrefix={testIdPrefix}
        />
      ))}
    </Box>
  );
}
