/**
 * The gap pass over contingency blocks (FUT-4717): every block read in keyset
 * pages to the end (a block that never settles — an OPEN one, an ABANDONED
 * one with an unknown rest — must not hide the ones reserved after it), its
 * KNOWN unused ranges voided at SEFAZ once, its UNKNOWN ones only reported.
 */

import { FiscalDocumentError } from "./errors";
import { xmlKeys } from "./helpers";
import { accountFor, gapOf, isSettled } from "./contingency-gaps";
import type { Deps } from "./service-profile";
import type { ContingencyBlockState, ContingencyBlockStore, ContingencyGap, FiscalStore } from "./ports";

/** How many blocks one read of a pass asks for; the pass reads pages until one comes back empty. */
export const BLOCK_PAGE_SIZE = 1_000;

const BLOCK_METHODS = [
  "reserveContingencyBlock",
  "findContingencyBlock",
  "listContingencyBlocks",
  "closeContingencyBlock",
  "settleContingencyBlock",
  "recordContingencyVoid",
  "getDocumentByAccessKey",
  "recordSignedDocument",
] as const;

export function blockStore(store: FiscalStore): FiscalStore & ContingencyBlockStore {
  const candidate = store as FiscalStore & Partial<ContingencyBlockStore>;
  if (BLOCK_METHODS.some((name) => typeof candidate[name] !== "function")) {
    throw new FiscalDocumentError("NOT_SUPPORTED", "this FiscalStore does not keep contingency blocks (ContingencyBlockStore).");
  }
  return candidate as FiscalStore & ContingencyBlockStore;
}

type BlockFilter = Omit<Parameters<ContingencyBlockStore["listContingencyBlocks"]>[0], "limit" | "after">;

/** Every page of the blocks a filter selects, in `(reservedAt, id)` order, to exhaustion. */
export async function* blockPages(store: ContingencyBlockStore, filter: BlockFilter): AsyncGenerator<ContingencyBlockState[]> {
  let after: { reservedAt: string; id: string } | undefined;
  for (;;) {
    const page = await store.listContingencyBlocks({ ...filter, ...(after === undefined ? {} : { after }), limit: BLOCK_PAGE_SIZE });
    const last = page[page.length - 1];
    // An empty page ends the read; a page that does not move the cursor would loop for ever.
    if (last === undefined || (after !== undefined && last.id === after.id)) return;
    yield page;
    after = { reservedAt: last.reservedAt, id: last.id };
  }
}

/** The blocks of the pages, one by one. */
async function* eachBlock(pages: AsyncGenerator<ContingencyBlockState[]>): AsyncGenerator<ContingencyBlockState> {
  for await (const page of pages) yield* page;
}

export async function allBlocks(store: ContingencyBlockStore, filter: BlockFilter): Promise<ContingencyBlockState[]> {
  const blocks: ContingencyBlockState[] = [];
  for await (const page of blockPages(store, filter)) blocks.push(...page);
  return blocks;
}

const ownerFilter = (ownerId: string | undefined) => (ownerId === undefined ? {} : { ownerId });

/** Known unused ranges of blocks reserved before `before` (ISO 8601), across owners unless one is named. */
export async function listKnownGaps(deps: Deps, input: { before: string; ownerId?: string }): Promise<ContingencyGap[]> {
  const blocks = await allBlocks(blockStore(deps.config.store), { ...ownerFilter(input.ownerId), reservedBefore: input.before, unsettledOnly: true });
  return blocks.flatMap((block) => accountFor(block).known.map((range) => gapOf(block, range)));
}

/** Ranges whose fate is unknown — flagged for the store, never voided. */
export async function listUnknownRanges(deps: Deps, input: { ownerId?: string }): Promise<ContingencyGap[]> {
  const blocks = await allBlocks(blockStore(deps.config.store), { ...ownerFilter(input.ownerId), fates: ["CLOSED", "ABANDONED"], unsettledOnly: true });
  return blocks.flatMap((block) => accountFor(block).unknown.map((range) => gapOf(block, range)));
}

export interface GapVoidReport {
  readonly voided: ReadonlyArray<ContingencyGap & { readonly protocol: string | null }>;
  readonly failures: ReadonlyArray<ContingencyGap & { readonly class: string; readonly code: string | null; readonly message: string }>;
}

const NOTHING: GapVoidReport = { voided: [], failures: [] };

/** Whether the gap is still unused right now: no note recorded and nothing voided inside it since the pass read it. */
async function stillUnused(store: ContingencyBlockStore, gap: ContingencyGap): Promise<boolean> {
  const fresh = await store.findContingencyBlock({
    ownerId: gap.ownerId, issuerCnpj: gap.issuerCnpj, environment: gap.environment, series: gap.series, number: gap.from,
  });
  if (fresh === null || fresh.id !== gap.blockId) return false;
  const inside = (n: number) => n >= gap.from && n <= gap.to;
  return !fresh.documented.some(inside) && !fresh.voided.some((range) => range.from <= gap.to && range.to >= gap.from);
}

async function voidGap(deps: Deps, store: ContingencyBlockStore, gap: ContingencyGap): Promise<GapVoidReport> {
  // A note handed in late since the page was read takes its number: leave the range for the next pass.
  if (!(await stillUnused(store, gap))) return NOTHING;
  const profile = await deps.ctx.requireProfile(gap.ownerId);
  const outcome = await deps.config.issuer.inutilize({
    model: "NFCE",
    environment: gap.environment,
    signing: await deps.ctx.material(profile),
    uf: profile.address.uf,
    cnpj: gap.issuerCnpj,
    year: Number(gap.reservedAt.slice(0, 4)),
    series: gap.series,
    from: gap.from,
    to: gap.to,
    reason: deps.config.reasons.inutilization,
  });
  if (!outcome.ok) {
    return { voided: [], failures: [{ ...gap, class: outcome.error.class, code: outcome.error.code, message: outcome.error.message }] };
  }
  const xml = outcome.answer.inutilizationXml;
  const eventXmlKey = xml === null ? null : xmlKeys.inutilizedRange(gap);
  if (eventXmlKey !== null) await deps.config.storage.put(eventXmlKey, xml ?? "", "application/xml");
  await store.recordContingencyVoid({
    id: deps.config.newId(),
    blockId: gap.blockId,
    range: { from: gap.from, to: gap.to },
    protocol: outcome.answer.protocol,
    eventXmlKey,
    at: deps.ctx.nowIso(),
  });
  return { voided: [{ ...gap, protocol: outcome.answer.protocol }], failures: [] };
}

/** Void one block's known ranges; settle it when nothing is left to account for. */
async function voidBlock(deps: Deps, store: ContingencyBlockStore, block: ContingencyBlockState): Promise<GapVoidReport> {
  const voided: GapVoidReport["voided"][number][] = [];
  const failures: GapVoidReport["failures"][number][] = [];
  for (const range of accountFor(block).known) {
    const one = await voidGap(deps, store, gapOf(block, range));
    voided.push(...one.voided);
    failures.push(...one.failures);
  }
  const done = voided.map(({ from, to }) => ({ from, to }));
  if (isSettled({ ...block, voided: [...block.voided, ...done] })) await store.settleContingencyBlock({ id: block.id, at: deps.ctx.nowIso() });
  return { voided, failures };
}

/**
 * One pass of the gap job: every KNOWN unused range of a block reserved
 * before `before` is inutilized once (one call per range); a failure is
 * reported and tried again on the next pass. A block left with nothing to
 * account for is settled and read no more. Unknown ranges are never voided.
 * Every unsettled block is read, page after page.
 */
export async function voidKnownGaps(deps: Deps, input: { before: string; ownerId?: string }): Promise<GapVoidReport> {
  const store = blockStore(deps.config.store);
  const report = { voided: [] as GapVoidReport["voided"][number][], failures: [] as GapVoidReport["failures"][number][] };
  const pages = blockPages(store, { ...ownerFilter(input.ownerId), reservedBefore: input.before, unsettledOnly: true });
  for await (const block of eachBlock(pages)) {
    const one = await voidBlock(deps, store, block);
    report.voided.push(...one.voided);
    report.failures.push(...one.failures);
  }
  return report;
}
