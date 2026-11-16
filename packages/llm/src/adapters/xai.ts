/**
 * The xAI (Grok) adapter (FUT-3738). xAI's API speaks OpenAI's Chat
 * Completions, so this is the OpenAI-compatible adapter under its own id,
 * with xAI's own API root and the store's own xAI key. It reads NOTHING from
 * the platform's `OPENAI_*` variables: the base URL, organisation and project
 * are passed explicitly and the sealed fetch sends only this key (B3).
 *
 * - No default model: a host names the Grok model it pays for.
 * - `cacheKey` is not sent: `prompt_cache_key` is OpenAI's parameter.
 * - Credentials: API keys only, as for OpenAI.
 * - The `openai` SDK is the optional peer this adapter needs.
 */
import type { ProviderAdapter } from "../adapter";
import { openAICompatibleAdapter, type OpenAIAdapterOptions } from "./openai";

export const XAI_PROVIDER = "xai";

/** Where xAI's API lives; never read from the environment. */
export const XAI_BASE_URL = "https://api.x.ai/v1";

export type XaiAdapterOptions = OpenAIAdapterOptions;

export function xaiAdapter(options: XaiAdapterOptions = {}): ProviderAdapter {
  return openAICompatibleAdapter({ ...options, id: XAI_PROVIDER, defaultBaseURL: XAI_BASE_URL, promptCacheKey: false });
}
