import type { DatabaseLogger } from './types';

/**
 * The fallback sink, used until a host calls {@link setLogger}.
 *
 * `no-console` is disabled here rather than obeyed (FUT-724): this object IS a
 * console logger — it is the seam's default implementation, not a call site
 * that forgot to use one. A host that wants these lines reported installs its
 * own logger (apps/web installs the Winston one, which carries the Sentry
 * transport); until it does, the console is the only sink that exists.
 */
/* eslint-disable no-console */
const DEFAULT_LOGGER: DatabaseLogger = {
  info: (message: string, data?: unknown) => console.info(message, data),
  error: (message: string, error?: unknown, data?: unknown) => console.error(message, error, data),
  warn: (message: string, data?: unknown) => console.warn(message, data),
  debug: (message: string, data?: unknown) => console.debug(message, data),
};
/* eslint-enable no-console */

let currentLogger: DatabaseLogger = DEFAULT_LOGGER;

export function setLogger(logger: DatabaseLogger): void {
  currentLogger = logger;
}

export function getLogger(): DatabaseLogger {
  return currentLogger;
}

export function createQueryProfiler(enableProfiling: boolean = true, enableLogging: boolean = true) {
  const start = Date.now();

  return (rowCount?: number | null, queryText?: string) => {
    if (!enableProfiling && !enableLogging) {
      return;
    }

    const end = Date.now();
    const duration = end - start;
    const durationStr = `${duration}ms`;

    if (enableLogging) {
      currentLogger.info('Executed query', {
        rows: rowCount,
        duration: durationStr,
        text: queryText,
      });
    }

    return duration;
  };
}
