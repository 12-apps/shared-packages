/**
 * withBatchSize
 * Generic utility to process an array in fixed-size batches sequentially.
 * Keeps peak memory lower than mapping the whole array concurrently.
 *
 * @param items Input items (readonly)
 * @param batchSize Positive integer > 0
 * @param handler Called per batch with (batchItems, batchIndex, globalOffset)
 *        It may return an array of outputs to be collected.
 * @param options Optional callbacks / collection toggle
 * @returns Aggregated outputs (empty array if nothing returned)
 */
export interface WithBatchSizeOptions<I, O> {
  collect?: boolean; // default true, if false we discard handler returns
  onBatchStart?: (batch: readonly I[], batchIndex: number, globalOffset: number) => void | Promise<void>;
  onBatchEnd?: (batch: readonly I[], batchIndex: number, globalOffset: number, produced: readonly O[] | undefined, elapsedMs: number) => void | Promise<void>;
}

// A handler may return one item, many, or nothing at all. Normalising that here
// keeps the loop below about batching rather than about return-value shapes.
const producedFrom = <O>(result: readonly O[] | O | void): readonly O[] | undefined => {
  if (result === undefined) return undefined;
  return Array.isArray(result) ? (result as readonly O[]) : [result as O];
};

export async function withBatchSize<I, O = unknown>(
  items: readonly I[],
  batchSize: number,
  handler: (batch: readonly I[], batchIndex: number, globalOffset: number) => Promise<readonly O[] | O | void> | (readonly O[] | O | void),
  options: WithBatchSizeOptions<I, O> = {},
): Promise<O[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('withBatchSize: batchSize must be a positive integer');
  }

  const { collect = true, onBatchStart, onBatchEnd } = options;
  const out: O[] = [];

  for (let offset = 0, batchIndex = 0; offset < items.length; offset += batchSize, batchIndex++) {
    const batch = items.slice(offset, offset + batchSize);
    const start = Date.now();
    if (onBatchStart) await onBatchStart(batch, batchIndex, offset);

    const produced = producedFrom<O>(await handler(batch, batchIndex, offset));
    if (collect && produced) out.push(...produced as O[]);

    const elapsed = Date.now() - start;
    if (onBatchEnd) await onBatchEnd(batch, batchIndex, offset, produced, elapsed);
  }

  return out;
}
