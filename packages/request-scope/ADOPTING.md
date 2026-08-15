# Adopting `@12-apps/request-scope`

An integration playbook. For what the package is and why it makes the choices it
does, see [`README.md`](./README.md); this is the "what do I wire, in what
order, and what will bite me" guide.

---

## 1. Install and mount

```bash
pnpm add @12-apps/request-scope
```

`hono` is an **optional** peer — resolve it only if you mount the `./hono`
adapter. The core entry point pulls in nothing at all.

```ts
import { requestScope } from '@12-apps/request-scope/hono';

const app = new Hono();
app.use('*', requestScope());   // BEFORE any route that reads a cookie
```

Not on Hono? The core exports the whole dance as one call:

```ts
import { serveWithRequestScope } from '@12-apps/request-scope';

const response = await serveWithRequestScope(request, () => dispatch(request));
```

Or open it by hand, which is what both of the above do:

```ts
const scope = createRequestScope(request);
const response = await runWithRequestScope(scope, () => handler(request));
return applyResponseCookies(scope, response);
```

## 2. Decide the encoding, once, before the first deploy

**This is the only decision that is hard to reverse**, because the wrong answer
is discovered in production as a session that will not restore.

| Your situation | Pass |
| --- | --- |
| New host, no cookies in the field | nothing — the default encodes, which is what RFC 6265 wants |
| Existing cookies written by a serializer that percent-encoded | nothing |
| Existing cookies written **raw**, and old code still reads them by hand | `createCookieCodec({ encode: false })` |

```ts
app.use('*', requestScope({ codec: createCookieCodec({ encode: false }) }));
```

Why it matters in one line: a **raw** value read by the **decoding** parser is
safe (decoding is the identity on a value with no `%`), but an **encoded** value
read by a **raw** parser is not — and that raw parser is your old deployed code,
which this package cannot reach. Adopt with `encode: false` if you have any, and
flip it once nothing parses those cookies by hand.

Values in the base64**url** alphabet (`A-Za-z0-9-_`) are unaffected either way;
`encodeURIComponent` leaves every one of those characters alone. It is `=`
padding, `;`, `,`, spaces and non-ASCII that move.

## 3. Replace your accessors

### If you are coming from `next/headers`

Change the import and nothing else. The names, shapes, async signatures and the
throw-outside-a-request behaviour all match.

```diff
-import { cookies, headers } from 'next/headers';
+import { cookies, headers } from '@12-apps/request-scope/next-compat';
```

`cookies()` returns a jar with `get` / `has` / `set` / `delete`; `get` yields
`{ name, value }` rather than a bare string, and a write is observable by the
next `get` in the same request — both as Next behaved.

**Prefer the core API in new code.** These accessors are `async` with nothing to
await, which is a Next 15 artifact rather than a design. A greenfield host wants
`requireRequestScope()`, which says what it does.

### If you are coming from a hand-rolled cookie reader

Delete it. The parser here splits on the **first** `=` (so a base64 payload
survives), keeps the **first** of a repeated name (the browser sends the
most-specific path first, and preferring the last would favour a
broader-scoped cookie a sibling subdomain can set), returns raw text for a
malformed percent escape instead of throwing on attacker input, and
distinguishes an empty value from an absent one.

If your old reader did `value.split('=')[1]`, it was truncating every value
containing `=`. Check what that cookie carried before you assume nothing broke.

## 4. Mount order is the thing adopters get wrong

A route registered **above** the middleware runs outside the scope, and its
accessors throw. That is intended — loud at the first request beats a silently
absent session — but it means "I added the middleware and half my routes broke"
is a mount-order bug, not a package bug.

```ts
app.get('/early', handler);      // ✗ outside the scope
app.use('*', requestScope());
app.get('/late', handler);       // ✓
```

## 5. If you already have an `AsyncLocalStorage` request store

You need both modules on **one** store, or each reads a store the other never
entered — and the symptom is `requireRequestScope()` throwing from inside a
perfectly ordinary request while every suite stays green.

```ts
import { declareRequestScopeKey } from '@12-apps/request-scope';

declareRequestScopeKey('__myHostRequestStore');  // wiring time, before serving
```

Call it once, before the first request. Calling it after a store exists throws
`RequestScopeConfigError` rather than silently stranding every scope already
entered under the old key.

The actor context in `@12-apps/audit` is **not** this store and does not need to
be shared with it — it carries *who is acting*, this carries *what arrived*.
Both are opened by the same adapter and are otherwise independent.

## 6. Writing cookies: which of the three ways

| You have | Use |
| --- | --- |
| no response — a helper deep in the call chain | `writeCookie(scope, …)` / `eraseCookie(scope, …)`, queued and merged on the way out |
| a response you just built | `setResponseCookie(res, …)` / `deleteResponseCookie(res, …)` |
| a redirect that also drops a cookie | `redirectResponse(url)` — mutable headers, defaults to 307 |

`Response.redirect()` works too: the adapter rebuilds it when its immutable
headers refuse the append. `redirectResponse()` simply avoids the rebuild, and
its 307 default preserves the request method where 302 would not.

## 7. Verify the wiring

Three checks that catch everything above:

```ts
// 1. the scope is open where you think it is
app.get('/_probe', (c) => c.json({ open: currentRequestScope() !== undefined }));

// 2. a queued cookie reaches the response
// 3. a cookie the handler wrote itself ALSO reaches it
```

That third one is the regression worth owning a test for. Merging cookies by
assigning to Hono's `c.res` silently drops the queued ones whenever the handler
wrote one of its own — the adapter here avoids it, and the package's
`hono/adapter.test.ts` pins both halves.

---

## Reference: what each entry point exports

**`@12-apps/request-scope`**

`createCookieCodec` · `createRequestScope` · `runWithRequestScope` ·
`serveWithRequestScope` · `currentRequestScope` · `requireRequestScope` ·
`writeCookie` · `eraseCookie` · `applyResponseCookies` · `setResponseCookie` ·
`deleteResponseCookie` · `redirectResponse` · `declareRequestScopeKey` ·
`DEFAULT_REQUEST_SCOPE_KEY` · `RequestScopeConfigError`

**`@12-apps/request-scope/hono`** — `requestScope(options?)`

**`@12-apps/request-scope/next-compat`** — `cookies()` · `headers()`
