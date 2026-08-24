import type { McpAiCopy } from "./copy";
import { EN_US_MCP_AI_COPY } from "./en-US";
import { PT_BR_MCP_AI_COPY } from "./pt-BR";

/**
 * The AI-integration screens in both languages, keyed by tag.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`. The named
 * single-language packs stay exported and unchanged.
 */
type LocalePack<T> = { readonly "pt-BR": T; readonly "en-US": T };

export const MCP_AI_COPY = {
  "pt-BR": PT_BR_MCP_AI_COPY,
  "en-US": EN_US_MCP_AI_COPY,
} as const satisfies LocalePack<McpAiCopy>;
