import type { ProviderAdapter } from "../adapter";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openaiAdapter } from "./openai";

/** Fresh instances of the three built-in adapters, with their defaults. */
export function builtInAdapters(): ProviderAdapter[] {
  return [anthropicAdapter(), openaiAdapter(), geminiAdapter()];
}

export * from "./anthropic";
export * from "./gemini";
export * from "./openai";
