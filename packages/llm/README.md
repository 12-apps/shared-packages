# @12-apps/llm

A provider-agnostic model connector. A host writes its prompt, its tools and
its metering once, against one interface. An adapter per provider maps that
interface onto the provider's official SDK and maps the answer back.

- **One interface** for a chat turn with tools, and one normalized result.
- **An abstract factory**, `createModelClient`, that picks the adapter by
  provider id from a registry the host can extend.
- **Built-in adapters** for Anthropic (`@anthropic-ai/sdk`), OpenAI (`openai`)
  and Gemini (`@google/genai`). The SDKs are optional peers: install the ones
  you use. Each SDK is imported only when its adapter makes its first call.
- **Credential strategies**: an API key, or an OAuth access token with a
  refresh hook, both behind one interface.
- **A tool-use loop** that reports every turn's usage.
- **Typed errors** and one retry hook the host supplies.

Only chat ships today. The `Capability` union leaves room for others (a
transcription capability is planned), and an adapter declares what it can do.

## Install

```bash
pnpm add @12-apps/llm @anthropic-ai/sdk   # plus `openai` and/or `@google/genai` if you use them
```

## A chat turn

```ts
import { createModelClient } from "@12-apps/llm";

const client = createModelClient({
  provider: "anthropic", // default model: claude-haiku-5-5
  credentials: { kind: "apiKey", apiKey: () => secrets.read("ANTHROPIC_API_KEY") },
});

const result = await client.chat({
  system: [
    { text: GENERAL_INSTRUCTIONS },                 // the same for every tenant
    { text: renderCatalog(catalog), cache: true },  // a breakpoint: everything up to here is cached
  ],
  messages: [{ role: "user", text: "Do you deliver on Sundays?" }],
  tools: [searchCatalog],
  toolChoice: "auto",
  maxOutputTokens: 1024,
  effort: "low",
});

result.text;        // the reply text
result.toolCalls;   // [{ id, name, input }], input already parsed
result.stopReason;  // "end" | "tool_use" | "max_tokens" | "refusal" | "other"
result.usage;       // { inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens, raw }
result.message;     // the turn as a message, ready to append to the conversation
```

### The request

| field | meaning |
|---|---|
| `system` | Ordered blocks, **most stable first**. `cache: true` (or `{ ttl: "1h" }`) puts a cache breakpoint at the end of the block. |
| `messages` | `user` (text), `assistant` (text, tool calls and the provider's `raw` turn) and `tool` (every result of the previous turn's calls, together). |
| `tools` | `{ name, description, inputSchema }`, where the schema is **strict** (below). |
| `toolChoice` | `auto`, `none` or `required` (at least one call). |
| `maxOutputTokens` | Required. |
| `effort` | `low`, `medium` or `high`. Each adapter maps it to its own setting. |
| `temperature` | A hint. Adapters whose API refuses sampling parameters drop it (Anthropic). |
| `cacheConversation` | Also cache the conversation so far (Anthropic). |
| `cacheKey` | A stable key that routes requests sharing a prefix together (OpenAI's `prompt_cache_key`). |
| `model` | Overrides the client's model for one call. |
| `signal` | An `AbortSignal`. |

### Strict tool schemas

Every provider's strict mode guarantees the model's arguments validate against
the schema, but each provider accepts a slightly different subset of JSON
Schema. The client accepts only schemas inside the subset all three share, and
refuses any other schema with an `InvalidRequestError` before any call:

- the root is `type: "object"`;
- every object sets `additionalProperties: false`;
- every object lists **all** its properties in `required`. An optional field is
  a nullable type: `{ "type": ["integer", "null"] }`.

`toolSchemaProblems(tools)` returns the same findings with a path to each.

### Usage

`inputTokens` counts only the input that was neither written to nor read from
the cache, so the four counters add up to everything billed and each can be
priced at its own rate. `raw` is the provider's own usage object.

| | Anthropic | OpenAI | Gemini |
|---|---|---|---|
| `inputTokens` | `input_tokens` | `prompt_tokens` − cached − cache writes | `promptTokenCount` (+ tool-use prompt) − cached |
| `cacheCreationTokens` | `cache_creation_input_tokens` | `cache_write_tokens` | 0 |
| `cacheReadTokens` | `cache_read_input_tokens` | `cached_tokens` | `cachedContentTokenCount` |
| `outputTokens` | `output_tokens` | `completion_tokens` | `candidatesTokenCount` + `thoughtsTokenCount` |

### Prompt caching per provider

- **Anthropic**: a `cache` block gets a `cache_control` breakpoint. Tools are
  rendered before the system prompt, so the first breakpoint caches the tool
  list too. A request may carry at most four breakpoints, `cacheConversation`
  included. A prefix shorter than the model's minimum cacheable length is
  silently not cached: check `usage.cacheReadTokens` on the second call.
- **OpenAI** and **Gemini** cache repeated prefixes by themselves. Breakpoints
  have nothing to map to, but the order still matters: keep the stable blocks
  first.

### Refusals

A refusal is a **result**: `stopReason: "refusal"` with `refusal: { category,
explanation }` when the provider says why (Anthropic's `stop_details`, OpenAI's
`message.refusal` or `content_filter`, Gemini's safety finish reasons and
blocked prompts). `ensureNotRefused(result)` throws a `RefusalError` for code
that prefers an exception.

## The factory and the registry

`createModelClient({ provider, model?, credentials, retry?, registry? })`
looks the provider id up in `registry`. When no registry is given, it uses a
registry of the three built-in adapters. It refuses an unknown provider or a
credential kind the adapter does not declare (`UnsupportedError`). It also
refuses a missing model when the adapter has none (`InvalidRequestError`):
only the Anthropic adapter ships a default model.

### Adding an adapter

An adapter implements `ProviderAdapter`:

```ts
import { createAdapterRegistry, builtInAdapters, mapProviderError, type ProviderAdapter } from "@12-apps/llm";

const localModel: ProviderAdapter = {
  id: "local",
  defaultModel: "my-model",
  capabilities: ["chat"],
  credentialKinds: ["apiKey"],
  async chat({ model, request, credential }) {
    try {
      const response = await myHttpClient.post("/chat", toWire(model, request), credential.secret);
      return fromWire(response); // a ChatResult
    } catch (error) {
      throw mapProviderError("local", error, [credential.secret]);
    }
  },
};

const registry = createAdapterRegistry(builtInAdapters()).register(localModel);
const client = createModelClient({ provider: "local", credentials, registry });
```

`register(adapter, { replace: true })` replaces a built-in adapter. Use it, for
example, to point Anthropic at a gateway with `anthropicAdapter({ baseURL })`.
Each built-in adapter also takes a `client` factory (`(credential) => sdkClient`).
Tests use it to inject a fake SDK client.

An adapter maps both directions and nothing else. The client does the work
every provider shares: the strict-schema check, the credential strategy and
its OAuth refresh, and the retry policy. A returned assistant turn may carry
`raw: { provider, content }`. The same adapter replays that content verbatim
on the next turn, so thinking blocks and thought signatures survive a tool
loop. Any other adapter rebuilds the turn from `text` and `toolCalls`.

## Credentials

```ts
// A static secret the host supplies, read through the resolver before every call.
{ kind: "apiKey", apiKey: () => vault.read("provider-key") }

// An access token with an expiry, and the host's refresh.
{
  kind: "oauth",
  token: () => store.currentToken(),        // { accessToken, expiresAt? (epoch ms) }
  refresh: async (reason) => {              // "expiring" | "unauthorized"
    const next = await myOAuth.refresh();
    await store.save(next);                 // the host keeps it, the package does not
    return next;
  },
  refreshSkewMs: 60_000,                    // refresh this close to expiry (default 60 s)
}
```

- The package **never stores, logs or returns a secret**. The credential an
  adapter receives prints as `[credential apiKey]` and keeps its value
  non-enumerable. Error messages are scrubbed of the secret the call used.
- **OAuth refresh**: a token within `refreshSkewMs` of `expiresAt` is
  refreshed before the call. After a 401, the client refreshes **once** and
  retries **once**. A second 401 is thrown as an `AuthError`.
- **Which strategies a provider accepts is the adapter's declaration**:
  Anthropic `apiKey`, `oauth`; OpenAI `apiKey`; Gemini `apiKey`, `oauth`. The
  package ships **no login UI and no login flow**, and it hard-codes no
  consumer-subscription sign-in. Obtaining a token is the host's job.
- The built-in adapters pass the credential to the SDK explicitly, so no SDK
  falls back to a key in the environment. Gemini is the one exception: its SDK
  prefers `GOOGLE_API_KEY` or `GEMINI_API_KEY` over any other credential. So
  the Gemini adapter refuses an OAuth call while either variable is set.

### Terms: enable a provider's OAuth only where its terms allow it

The `oauth` strategy is generic, but a provider's terms decide which tokens a
third-party product may use:

- **Anthropic**: the consumer terms bar using Claude Free, Pro or Max
  subscription OAuth in a third-party product. That includes doing it through
  the Agent SDK. Use API keys, or OAuth tokens Anthropic issues for API access
  (for example, workload identity federation).
- **OpenAI**: a ChatGPT or Codex sign-in is in the same position. The OpenAI
  adapter accepts API keys only.
- **Google**: Google's own OAuth for the Gemini API is a documented way to
  authenticate, so the Gemini adapter accepts it.

A host enables a provider's OAuth strategy only where that provider's terms
allow it, and a tenant that brings its own credentials answers for its own
provider's terms.

## The tool-use loop

```ts
import { runToolLoop } from "@12-apps/llm";

const outcome = await runToolLoop({
  client,
  request,                                       // the first turn's request
  executors: { search_catalog: (input) => searchCatalog(input) },
  maxTurns: 6,                                   // default 8
  onUsage: (usage, turn) => meter.record(usage), // once per turn, refused turns included
});

outcome.status;   // "completed" | "refused" | "max_turns" | "max_tokens" | "stopped"
outcome.messages; // the conversation with every turn and tool result appended
outcome.usage;    // the summed usage
outcome.refusal;  // set when status is "refused"
```

The loop runs every tool call of a turn and sends all the results back
together. An unknown tool, or an executor that throws, becomes an error result
the model can read and recover from. When the turn limit is reached, the loop
stops without running the last turn's calls.

## Errors and retries

| class | when |
|---|---|
| `AuthError` | 401 or 403 |
| `RateLimitError` | 429; `retryAfterMs` comes from `retry-after-ms` or `retry-after` |
| `InvalidRequestError` | 400, 404, 413 or 422, a non-strict tool schema, too many breakpoints |
| `ProviderUnavailableError` | 5xx, 529, 408, network failures |
| `InvalidResponseError` | an answer the adapter cannot read (tool arguments that are not JSON) |
| `RefusalError` | thrown only by `ensureNotRefused` |
| `UnsupportedError` | an unknown provider, an undeclared credential kind, a missing optional SDK |

All of them extend `LlmError`, which has `kind`, `provider` and `status`. The
SDKs' own retries are switched off. The host's `retry` hook is the whole
policy: `(error, attempt) => delayMs | null`. With no hook, nothing is retried.
`retryTransient({ maxAttempts, baseDelayMs })` retries rate limits (using the
provider's hint) and outages with exponential backoff.
