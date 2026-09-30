/**
 * The part of the Sentry SDK that `index.ts` calls, as one lazily loaded module.
 *
 * `index.ts` reaches this through `import("./sdk")` once the page has loaded.
 * Importing `@sentry/react` itself that way would hand Rollup a namespace it
 * cannot shake, and the chunk carried Replay, Feedback and the canvas recorder
 * nobody calls: 377,161 raw bytes, against the 98,430 the named imports below
 * cost. Named imports here keep the shake; a name added to `index.ts` is added
 * to this list.
 */
import { captureException, captureMessage, getClient, init, setTag, withScope } from "@sentry/react";

export const sdk = { captureException, captureMessage, getClient, init, setTag, withScope };

export type Sdk = typeof sdk;
