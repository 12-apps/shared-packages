# @12-apps/llm

A provider-agnostic model connector. A host writes its prompt, its tools and
its metering once, against one interface. An adapter per provider maps that
interface onto the provider's official SDK and maps the answer back.

- **One interface** for a chat turn with tools, and one normalized result.
- **An abstract factory**, `createModelClient`, that picks the adapter by
  provider id from a registry the host can extend.
- **Built-in adapters** for Anthropic (`@anthropic-ai/sdk`), OpenAI (`openai`),
  Gemini (`@google/genai`) and xAI's Grok (over the `openai` SDK, since xAI
  speaks OpenAI's Chat Completions). Swapping providers is a change of
  `provider` and credentials, nothing else. The SDKs are optional peers:
  install the ones you use. Each SDK is imported only when its adapter makes its first call.
- **Credential strategies**: an API key, or an OAuth access token with a
  refresh hook, both behind one interface.
- **A tool-use loop** that reports every turn's usage.
- **Typed errors** and one retry hook the host supplies.
- **A support ladder**: automation, then model tiers that escalate, then a
  person, with least-privilege tools per tier bound to the host's scope.

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
Schema. The client accepts only schemas inside the subset all four share, and
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

| | Anthropic | OpenAI | Gemini | xAI |
|---|---|---|---|---|
| `inputTokens` | `input_tokens` | `prompt_tokens` − cached − cache writes | `promptTokenCount` (+ tool-use prompt) − cached | same as OpenAI |
| `cacheCreationTokens` | `cache_creation_input_tokens` | `cache_write_tokens` | 0 | same as OpenAI |
| `cacheReadTokens` | `cache_read_input_tokens` | `cached_tokens` | `cachedContentTokenCount` | same as OpenAI |
| `outputTokens` | `output_tokens` | `completion_tokens` | `candidatesTokenCount` + `thoughtsTokenCount` | same as OpenAI |

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
registry of the four built-in adapters. It refuses an unknown provider or a
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
  isRevoked: () => accounts.isDisconnected(id), // optional: the host's "account disconnected" check
}
```

- The package **never stores, logs or returns a secret**. The credential an
  adapter receives prints as `[credential apiKey]` and keeps its value
  non-enumerable. Error messages are scrubbed of the secret the call used.
- **OAuth refresh**: a token within `refreshSkewMs` of `expiresAt` is
  refreshed before the call. After a 401, the client refreshes **once** and
  retries **once**. A second 401 is thrown as an `AuthError`.
- **A refresh is single-flight per client.** Concurrent calls that find the
  token expiring, or that get a 401, share one `refresh()`: providers rotate
  the refresh token on use, and two refreshes racing can revoke the login. A
  401 on a token older than the last refresh takes that refresh's token
  instead of rotating again.
- **Revoking an OAuth credential**: pass `isRevoked` and return true once the
  account is disconnected. From then on `current()` and `afterUnauthorized()`
  throw `CredentialRevokedError` (an `AuthError`, no status), and a refresh
  that was in flight when the host revoked is discarded: its waiters get the
  same error and its token is neither returned nor cached.
- **Which strategies a provider accepts is the adapter's declaration**:
  Anthropic `apiKey`, `oauth`; OpenAI `apiKey`; Gemini `apiKey`, `oauth`;
  xAI `apiKey`. The
  package ships **no login UI and no login flow**, and it hard-codes no
  consumer-subscription sign-in. Obtaining a token is the host's job.
- **A store's credential reaches its provider alone.** Left unset, the SDKs
  read the process environment: `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`,
  `OPENAI_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
  `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, the `*_CUSTOM_HEADERS`
  variables and more. On a server holding the platform's own account, a store's
  key would then be billed to the platform's project, routed through its proxy
  or sent beside its token. So the built-in adapters pass every such option
  explicitly: the base URL, a `null` organisation and project, a `null` second
  credential, and `vertexai: false`. And every request goes through a sealed
  `fetch`, the shape of a credential gateway. It refuses any URL outside the
  adapter's base URL, **and any path or method the adapter does not use**
  (Anthropic `POST /v1/messages`, OpenAI and xAI `POST /chat/completions`,
  Gemini `POST /v1[beta]/models/<model>:generateContent`; `InvalidRequestError`
  otherwise), drops every auth and account header the SDK set, and sets only
  the call's own credential. It never follows a redirect: a 3xx from the
  provider is thrown as an `InvalidRequestError` carrying its status, so a key
  header cannot ride to another origin. A `baseURL` the host passes is honoured.
- Gemini's SDK prefers `GOOGLE_API_KEY` or `GEMINI_API_KEY` over an OAuth
  token, so the Gemini adapter refuses an OAuth call while either is set.
- **The tool loop's transcript is always a valid next request.** A turn the
  loop ends on (`max_turns`, `max_tokens`, a refusal) keeps its text but never
  a tool call nobody answered, and a turn with no text and no call is not
  appended at all.

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

outcome.status;   // "completed" | "refused" | "max_turns" | "max_tokens" | "stopped" | "halted"
outcome.messages; // the conversation with every turn and tool result appended
outcome.usage;    // the summed usage
outcome.refusal;  // set when status is "refused"
```

The loop runs every tool call of a turn and sends all the results back
together. An unknown tool, or an executor that throws, becomes an error result
the model can read and recover from. When the turn limit is reached, the loop
stops without running the last turn's calls. An executor that returns
`{ output, halt: true }` ends the loop with `status: "halted"` once every call
of that turn has its result, and no further model call is made.

## The support ladder

`createSupportLadder` routes each customer message up a ladder. Automation
answers what the host recognises with no model call. Anything else goes to
the first model tier, which answers or escalates. A tier escalates to the next
tier, which runs on the same message in the same call, or to a person. The
ladder carries no domain: tiers, tools, copy and the person are all the host's.

```ts
import { createSupportLadder, mcpTools } from "@12-apps/llm";

const ladder = createSupportLadder<{ accountId: string }, { locale: string }>({
  automation: {
    greeting: () => "Hi! Reply 1 for opening hours, 2 to reset your password.",
    match: (message) => (message.trim() === "1" ? { reply: "We answer 9 to 5, Monday to Friday." } : null),
  },
  tiers: [
    {
      id: "triage",
      client: { provider: "openai", model: "gpt-5-mini", credentials },     // or a ModelClient
      instructions: "You answer simple helpdesk questions from the knowledge base.",
      tools: [searchArticles],                                              // read-only
    },
    {
      id: "specialist",
      client: { provider: "anthropic", model: "claude-opus-5-5", credentials },
      instructions: "You resolve account problems, or hand them to a person.",
      tools: [
        searchArticles,
        mcpTools({
          connect: (scope) => accountServer.connectAs(scope.accountId),     // the scope's own token
          allow: ["reset_password"],                                        // nothing else of the server's
        }),
      ],
    },
  ],
  person: { handOff: ({ conversationId, reason, fromTier }) => queue.push({ conversationId, reason, fromTier }) },
  state: {
    get: (id) => levels.get(id),
    // ATOMIC compare-and-set: store `to` only while the level is still `from`.
    raise: (id, from, to) => levels.compareAndSet(id, from, to),         // true when it moved
  },
  scopeFields: ["accountId"],                 // the model may never set these
  onUsage: (tier, usage) => meter.record(tier, usage),
});

const result = await ladder.handle({
  conversationId: "conv-42",
  message: "I can't sign in",
  transcript,                                 // the conversation before this message
  context: { locale: "en" },
  scope: { accountId: "acct-7" },             // from the host's session, never from the model
});

switch (result.kind) {
  case "automation": send(result.reply); break;          // source: "greeting" | "match"
  case "model":      send(result.reply); break;          // result.tier answered
  case "person":     notifyAgent(result); break;         // fromTier, reason, handedOff
}
result.usage;        // [{ tier, turns, usage }] per tier that ran, to meter each model separately
result.escalations;  // [{ from, to, reason }]
```

- **Each tier answers or escalates.** Every tier gets the ladder's `escalate`
  tool, `{ to: "next" | "person", reason }`; `"next"` is not offered on the last
  tier. A refusal escalates with reason `"refused"`, and a turn with no words
  with `"no_answer"`: to the next tier, or to a person from the last. A turn
  that calls `escalate` leaves the tier: the other tools it called in that
  turn are answered "not run" and never execute, and when it calls `escalate`
  more than once, the FIRST call (in the model's order) decides and the rest
  are ignored.
- **The next tier hears why.** The escalating tier's reason reaches the next
  tier as a delimited USER-role note just before the customer's message
  (`<handover from="…">…</handover>`, at most 500 characters, angle brackets
  removed), never as a system block: it is the prior model's words, derived
  from the customer's. The note is left out of the `messages` a result returns.
- **A conversation stays where it reached.** The `state` port stores the tier
  that answered, or `"person"` (`WITH_PERSON`). The next message goes straight
  to that tier; automation is consulted only before a conversation reached a
  tier. Once a person has it, `handle` returns `{ kind: "person", handedOff:
  false }` and never calls a model or `handOff` again.
- **Two messages in flight.** A customer can send two lines before the first
  is answered, so the ladder never writes a level blindly. The port's one
  write is `raise(conversationId, from, to) → boolean`, which the host makes
  ATOMIC (a conditional `UPDATE … WHERE level = $from`, a Redis `WATCH`/Lua
  compare-and-set, a Map on one event loop). The ladder only raises: an answer
  from a lower tier leaves a higher stored level alone, and an answer that
  finishes after the conversation reached a person returns `{ kind: "person",
  handedOff: false, fromTier: null }` instead of the model's reply. Only the
  call whose raise to `"person"` wins calls `handOff`, once, after the raise.
  A raise that loses re-reads and retries; a port whose level keeps moving
  is refused (`state_conflict`).
- **Resetting a conversation.** The host resets one by deleting its stored
  level, so `get` returns nothing: the next message starts at automation and
  the first tier again. The ladder has no reset of its own and never lowers a
  level. A conversation stored on a tier id that no longer exists (a tier
  renamed or removed) starts again at the first tier, skipping automation.
- **Least privilege per tier.** A tier's model sees exactly that tier's tools
  plus `escalate`. A call to another tier's tool is answered as an unknown
  tool and never runs.
- **Tools from MCP.** `mcpTools({ connect, allow, overrides? })` connects for
  each call's scope and offers ONLY the allow-listed tools; the rest of the
  server's list is never shown, and a call to one never reaches the server.
  An allowed tool the server lacks is refused (`tool_missing`; the
  conversation then goes to a person, see "A tool source that fails"). The client is
  structural (`listTools`, `callTool`, as the official MCP SDK's `Client`), so
  the package depends on no MCP SDK. Tool schemas must be strict; `overrides`
  replaces a description or schema the server ships loose.
- **What `mcpTools` costs.** Every `handle` call, for every tier that runs,
  calls `connect(scope)` and lists the server's tools (every page). Nothing is
  cached inside the package, on purpose, so one scope's client never serves
  another's. Cache on the host's side, keyed by the scope: have `connect`
  return a client kept per scope (an LRU of connections, with the scope's own
  credentials), and close it when the scope's session ends.
- **A tool source that fails.** When a source throws (`connect` fails, an
  allowed tool is missing, a server tool clashes with `escalate` or exposes a
  scope field), the conversation goes to a person with reason
  `"tool_error"`, and `usage` still lists the tiers that already ran.
- **Scope binding.** `scope` is opaque to the ladder. Every tool's `run` gets
  it in its context, and an MCP server gets it through the host's `connect`,
  never through the model. For a server whose tools take the tenant as an
  ARGUMENT, `mcpTools({ …, bindArgs: (scope, toolName) => ({ tenantId:
  scope.tenantId }) })` merges those arguments AFTER the model's input (the
  host's value wins), removes their names from the schema the model sees, and
  refuses, without reaching the server, a model call that sets one. A tool
  whose schema declares a `scopeFields` name is refused (`scope_exposed`), and a model call whose arguments carry one is
  refused without running, so a conversation for one account cannot reach
  another's data even when both use the same tools.
- **Refused configurations** throw `SupportLadderError` (an
  `InvalidRequestError`) with a `code`: `empty_tiers`, `duplicate_tier` (a tier
  id listed twice), `reserved_tier` (a tier named `"person"`), `tool_conflict`,
  `tool_missing`, `scope_exposed`; and `state_conflict` when the state port's
  level keeps changing while the ladder raises it.

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
| `SupportLadderError` | a support ladder's configuration or state refused; see `code` |

All of them extend `LlmError`, which has `kind`, `provider` and `status`. The
SDKs' own retries are switched off. The host's `retry` hook is the whole
policy: `(error, attempt) => delayMs | null`. With no hook, nothing is retried.
`retryTransient({ maxAttempts, baseDelayMs })` retries rate limits (using the
provider's hint) and outages with exponential backoff.
