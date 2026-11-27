import type { ByteTransport } from "./types.js";

/** Sleep no longer than the timer or the life of this connection. */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

/** Stop waiting on I/O even when its driver ignores a disconnect or deadline. */
export function runIo<T>(operation: () => Promise<T>, signal: AbortSignal, timeoutMs?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Scale operation stopped"));
      return;
    }
    const timer = timeoutMs === undefined ? undefined : setTimeout(stopped, timeoutMs);
    signal.addEventListener("abort", stopped, { once: true });
    function dispose() {
      clearTimeout(timer);
      signal.removeEventListener("abort", stopped);
    }
    function stopped() {
      dispose();
      reject(new Error("Scale operation stopped"));
    }
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error("Scale operation stopped");
      return operation();
    }).then(
      (value) => { dispose(); resolve(value); },
      (error: unknown) => { dispose(); reject(error); },
    );
  });
}

export async function closeTransport(transport: ByteTransport): Promise<void> {
  await runIo(() => transport.close(), new AbortController().signal, 2000).catch(() => undefined);
}
