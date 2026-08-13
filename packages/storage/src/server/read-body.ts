/**
 * Reading an upload body without ever trusting its declared size.
 *
 * Rejects up front when `content-length` already exceeds the cap, then
 * accumulates the stream chunk by chunk and CANCELS it the moment the running
 * total crosses — so an oversize upload can never force the process to allocate
 * the whole payload before the 413. A chunked request sends no length at all,
 * which is why the incremental half is not redundant.
 *
 * `null` means "too large". A missing body reads as empty (0 bytes), which the
 * caller refuses the same way it refuses any empty file.
 */
export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
