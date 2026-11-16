import type { ProviderAdapter } from "../adapter";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openaiAdapter } from "./openai";
import { xaiAdapter } from "./xai";

/** Fresh instances of the built-in adapters, with their defaults. */
export function builtInAdapters(): ProviderAdapter[] {
  return [anthropicAdapter(), openaiAdapter(), geminiAdapter(), xaiAdapter()];
}

export * from "./anthropic";
export * from "./gemini";
export * from "./openai";
export * from "./xai";
