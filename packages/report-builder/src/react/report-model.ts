/**
 * The report draft model (FUT-391): a report IS a dashboard — a named document
 * holding N blocks on a 12-column canvas — so the editor's state is that list
 * plus its layout, and every mutation here is a pure function over it.
 *
 * Two invariants live in this file so no caller can break them:
 *   - a block's `span` is always valid for its CURRENT presentation (switching
 *     a KPI tile to a table widens the block instead of leaving a 2-column
 *     table nobody can read);
 *   - a legacy single-spec document (pre-FUT-391, one report = one query) opens
 *     as a one-block report, so old documents keep working and become regular
 *     multi-block reports the moment they are saved again.
 */
import { clampBlockHeight, clampBlockSpan } from "../layout";

import { specFromDraft, starterDraft } from "./builder-model";
import type {
  DashboardBlockRender,
  DashboardBlockWire,
  DashboardSpecWire,
  ReportDocumentWire,
  ReportEntityFields,
  ReportSpecWire,
  SavedReportSummary,
  SavedReportView,
} from "./custom-reports-api";

export interface ReportBlockDraft {
  id: string;
  title: string;
  span: number;
  /**
   * The block's height tier (1..3), or `undefined` for its own content height
   * (FUT-755). `undefined` is not "unset pending a default" — it is the value
   * every block saved before heights existed has, and the one that keeps them
   * rendering exactly as they do now.
   */
  height?: number;
  spec: ReportSpecWire;
}

export interface ReportDraft {
  name: string;
  description: string;
  blocks: ReportBlockDraft[];
}

/** A new block's width before the presentation's floor applies: half the canvas. */
const DEFAULT_BLOCK_SPAN = 6;

export const REPORT_MAX_BLOCKS = 12;

export function emptyReportDraft(): ReportDraft {
  return { name: "", description: "", blocks: [] };
}

/** Whether a stored document is the multi-block form (vs. a legacy single spec). */
function isDashboardWire(document: ReportDocumentWire): document is DashboardSpecWire {
  return "kind" in document && document.kind === "dashboard";
}

/**
 * The next free `bloco-N` id (ids stay stable across reorders).
 *
 * Exported because the CANVAS needs to know which block a mutation is about to
 * create, so it can select and focus it. The alternative — diffing the draft
 * from inside the `setState` updater — makes the updater impure, and React is
 * allowed to (and under StrictMode does) run it twice.
 */
export function nextBlockId(blocks: ReportBlockDraft[]): string {
  const taken = new Set(blocks.map((block) => block.id));
  let candidate = blocks.length + 1;
  while (taken.has(`bloco-${candidate}`)) candidate += 1;
  return `bloco-${candidate}`;
}

export function addBlock(draft: ReportDraft, spec: ReportSpecWire, title: string): ReportDraft {
  const block: ReportBlockDraft = {
    id: nextBlockId(draft.blocks),
    title,
    span: clampBlockSpan(DEFAULT_BLOCK_SPAN, spec.presentation),
    // No height: a new block is as tall as what it renders, same as before.
    spec,
  };
  return { ...draft, blocks: [...draft.blocks, block] };
}

/**
 * Copy a block and put the copy DIRECTLY AFTER it (FUT-755, GAP 6).
 *
 * Not at the end: on a canvas already a screen tall, a duplicate that lands
 * twelve rows down reads as "nothing happened". Next to its source is also
 * where a duplicate is going to be used — the reason to duplicate is to vary
 * one thing about the block beside it.
 *
 * The copy is INDEPENDENT: the spec is cloned, so editing the copy's measures
 * or filters cannot reach back into the original. A shallow `{...block}` would
 * share one `spec` object between the two, and the config panel patches specs
 * in place often enough that this is not theoretical.
 *
 * An unknown id is a no-op, matching every other mutation in this file.
 */
export function duplicateBlock(draft: ReportDraft, id: string): ReportDraft {
  const index = draft.blocks.findIndex((block) => block.id === id);
  const source = draft.blocks[index];
  if (source === undefined) return draft;
  const copy: ReportBlockDraft = {
    id: nextBlockId(draft.blocks),
    title: `${blockLabel(source)} (cópia)`,
    span: source.span,
    ...(source.height === undefined ? {} : { height: source.height }),
    // A spec is pure JSON by contract (see `spec.ts`), so this round-trip is a
    // complete deep copy — and one that works identically in the browser, in
    // jsdom and on the server, which `structuredClone` does not.
    spec: JSON.parse(JSON.stringify(source.spec)) as ReportSpecWire,
  };
  const blocks = [...draft.blocks];
  blocks.splice(index + 1, 0, copy);
  return { ...draft, blocks };
}

export function removeBlock(draft: ReportDraft, id: string): ReportDraft {
  return { ...draft, blocks: draft.blocks.filter((block) => block.id !== id) };
}

/** Patch a block's own fields; a new width is clamped to what it can render at. */
export function updateBlock(
  draft: ReportDraft,
  id: string,
  patch: Partial<Pick<ReportBlockDraft, "title" | "span" | "height">>,
): ReportDraft {
  return {
    ...draft,
    blocks: draft.blocks.map((block) => {
      if (block.id !== id) return block;
      const next = { ...block, ...patch };
      return {
        ...next,
        span: clampBlockSpan(next.span, next.spec.presentation),
        height: clampBlockHeight(next.height),
      };
    }),
  };
}

/**
 * Replace a block's query (the pen popup's output). The width follows: a spec
 * whose new presentation needs more room widens the block right there on the
 * canvas, which is also the feedback that the change had a layout cost.
 */
export function updateBlockSpec(
  draft: ReportDraft,
  id: string,
  spec: ReportSpecWire,
): ReportDraft {
  return {
    ...draft,
    blocks: draft.blocks.map((block) =>
      block.id === id
        ? {
            ...block,
            spec,
            span: clampBlockSpan(block.span, spec.presentation),
            height: clampBlockHeight(block.height),
          }
        : block,
    ),
  };
}

/**
 * How a block is NAMED when it is spoken rather than read — its own title, or
 * a stand-in for one that has never been given a name.
 *
 * The stand-in is deliberately not positional: "Bloco 4" would rename itself
 * the moment the block moved, which is precisely when the name is being read
 * out ("Bloco 4 movido para a posição 3" describes a block that no longer
 * exists under that name).
 */
export function blockLabel(block: ReportBlockDraft): string {
  const title = block.title.trim();
  return title === "" ? "Bloco sem título" : title;
}

/** Move a block one position up (-1) or down (+1); out-of-range is a no-op. */
export function moveBlock(draft: ReportDraft, id: string, delta: -1 | 1): ReportDraft {
  const index = draft.blocks.findIndex((block) => block.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= draft.blocks.length) return draft;
  const blocks = [...draft.blocks];
  const [moved] = blocks.splice(index, 1);
  if (!moved) return draft;
  blocks.splice(target, 0, moved);
  return { ...draft, blocks };
}

/**
 * Drop `sourceId` into `targetId`'s position (drag-and-drop, FUT-311);
 * unknown ids and self-drops are no-ops.
 */
export function reorderBlock(
  draft: ReportDraft,
  sourceId: string,
  targetId: string,
): ReportDraft {
  const from = draft.blocks.findIndex((block) => block.id === sourceId);
  const to = draft.blocks.findIndex((block) => block.id === targetId);
  if (from < 0 || to < 0 || from === to) return draft;
  const blocks = [...draft.blocks];
  const [moved] = blocks.splice(from, 1);
  if (!moved) return draft;
  blocks.splice(to, 0, moved);
  return { ...draft, blocks };
}

/** Assemble the document the save endpoint validates. */
export function documentFromDraft(draft: ReportDraft): DashboardSpecWire {
  return {
    kind: "dashboard",
    blocks: draft.blocks.map((block): DashboardBlockWire => {
      const title = block.title.trim();
      return {
        id: block.id,
        ...(title === "" ? {} : { title }),
        span: block.span,
        // OMITTED when there is none, never written as a default: a document
        // that has always been content-height must stay byte-identical.
        ...(block.height === undefined ? {} : { height: block.height }),
        spec: block.spec,
      };
    }),
  };
}

/**
 * Rebuild the editable draft from a stored document. A legacy single-spec
 * document becomes a single full-width block — the author sees their report
 * exactly as before, now on the canvas where it can gain neighbours.
 */
export function draftFromDocument(
  name: string,
  description: string | null,
  document: ReportDocumentWire,
): ReportDraft {
  const base = { name, description: description ?? "" };
  if (!isDashboardWire(document)) {
    return { ...base, blocks: [{ id: "bloco-1", title: "", span: 12, spec: document }] };
  }
  return {
    ...base,
    blocks: document.blocks.map((block) => ({
      id: block.id,
      title: block.title ?? "",
      span: clampBlockSpan(block.span, block.spec.presentation),
      height: clampBlockHeight(block.height),
      spec: block.spec,
    })),
  };
}

/**
 * The blocks a VIEWER renders, from either shape of saved document — the one
 * seam that lets the viewer and the editor share a single grid component.
 */
export function viewBlocks(view: SavedReportView): DashboardBlockRender[] {
  if (view.type === "dashboard") return view.blocks;
  return [{ id: "bloco-1", span: 12, status: "ok", render: view.render }];
}

/**
 * A measure for an entity whose catalog entry ships no starter spec: the first
 * measure field summed, else counting the first field. A block must be
 * RUNNABLE the moment it is added (a spec with zero measures is rejected by the
 * compiler), so "no starter" degrades to a valid trivial report, never to a
 * block that renders an error before the author has touched it.
 */
function fallbackMeasure(entity: ReportEntityFields): ReportSpecWire["measures"][number] {
  const measure = entity.fields.find((field) => field.role === "measure");
  if (measure) return { field: measure.field, aggregation: "sum" };
  const first = entity.fields[0];
  return { field: first?.field ?? "id", aggregation: "count" };
}

/**
 * The spec a NEWLY added block starts from: the entity's starter (FUT-308's
 * known-good smart default), so the block fetches and renders real data on the
 * canvas immediately instead of sitting empty until configured.
 */
export function starterBlockSpec(entity: ReportEntityFields): ReportSpecWire {
  const fields = new Map(entity.fields.map((field) => [field.field, field]));
  const spec = specFromDraft(starterDraft(entity, entity.entity), fields);
  if (spec.measures.length > 0) return spec;
  return { ...spec, measures: [fallbackMeasure(entity)] };
}

/** What the reports picker offers, and which report it lands on. */
interface ReportPicker {
  options: SavedReportSummary[];
  /** Empty when the tenant has no report the picker can offer. */
  selectedId: string;
}

/**
 * Resolve the picker (FUT-391). Archived reports are hidden until asked for,
 * with one deliberate exception: the report currently OPEN stays listed even
 * when it no longer matches the filter — a deep link to an archived report
 * must open it (with the ⋮ menu offering "Restaurar"), not silently swap to
 * someone else's report.
 */
export function selectReportOptions(
  reports: readonly SavedReportSummary[],
  showArchived: boolean,
  requestedId: string | undefined,
): ReportPicker {
  const matchesFilter = (report: SavedReportSummary): boolean =>
    showArchived ? report.status === "archived" : report.status !== "archived";
  const options = reports.filter(
    (report) => matchesFilter(report) || report.id === requestedId,
  );
  const requested = requestedId
    ? options.find((report) => report.id === requestedId)
    : undefined;
  return { options, selectedId: requested?.id ?? options[0]?.id ?? "" };
}
