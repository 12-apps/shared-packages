/**
 * The pull-to-refresh copy, in its OWN file rather than beside the invite's
 * (12-62).
 *
 * The split is a consumer's critical path, not tidiness. A host mounts the
 * gesture at its app root, so whatever that import reaches is eager — and while
 * these four strings lived next to the invite's pack, reaching them put that
 * module in the entry's graph. A bundler then folded the invite's small chunk
 * down into the entry, and code that only ever runs on a checkout confirmation
 * screen landed in front of every visitor's first paint. Measured in a real
 * host: the invite moved out of a lazy chunk and into the entry.
 *
 * The original file re-exports this, so existing imports are unchanged.
 */

import type { PullToRefreshMessages } from "./messages";

/** The pull-to-refresh pack, en-US. */
export const EN_US_PULL_TO_REFRESH_MESSAGES: PullToRefreshMessages = {
  pulling: "Pull to refresh",
  armed: "Release to refresh",
  refreshing: "Refreshing…",
  label: "Refresh the screen",
};
