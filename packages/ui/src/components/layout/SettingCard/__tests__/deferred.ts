/**
 * A promise the test settles by hand, so a pending save can be observed
 * before it resolves or rejects.
 *
 * The executor runs synchronously inside `new Promise`, so by the time this
 * returns `handle` already holds the real settlers.
 */
interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

export function deferred(): Deferred {
  const handle = {} as Deferred;
  handle.promise = new Promise<void>((resolve, reject) => {
    Object.assign(handle, { resolve, reject });
  });
  return handle;
}
