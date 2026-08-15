# `@12-apps/request-scope`

The ambient per-request scope for a host serving web-standard
`Request`/`Response`: read the incoming headers and cookies from anywhere in the
call chain, queue a cookie write from code that has no response in hand, and
have both merged onto the answer on the way out.

Zero runtime dependencies. `node:async_hooks` and nothing else.

---

## The problem it solves

A web-standard handler takes a `Request` and returns a `Response`. That is a
clean contract right up to the moment something twelve calls deep needs to know
who is calling — a cart keyed by a cookie, a consent gate, an impersonation
marker, an incoming bearer. There are two ways out:

1. **Thread the `Request` through every intervening signature.** This turns a
   transport detail into a parameter of the domain layer, and it is viral: one
   new cookie reader changes a dozen function signatures and their tests.
2. **An ambient accessor**, backed by an explicit store.

This package is the second, and the store is the point. `AsyncLocalStorage` is
easy to reach for and easy to get subtly wrong — the store identity across a hot
reload, the write half that has nowhere to write, the redirect whose headers
refuse a `Set-Cookie`. Those are the parts worth sharing.

## The three entry points

| Import | For |
| --- | --- |
| `@12-apps/request-scope` | the framework-free core — the store, the codec, the response helpers |
| `@12-apps/request-scope/hono` | the Hono middleware (`hono` is an **optional** peer) |
| `@12-apps/request-scope/next-compat` | `cookies()` / `headers()` with `next/headers`' shapes, for a host migrating off the App Router |

```ts
import { requestScope } from '@12-apps/request-scope/hono';

app.use('*', requestScope());
```

That is the whole wiring. Then, anywhere downstream:

```ts
import { requireRequestScope, writeCookie } from '@12-apps/request-scope';

const scope = requireRequestScope();
const cartId = scope.values.get('cart');
writeCookie(scope, 'cart', nextId, { httpOnly: true, sameSite: 'lax', path: '/' });
```

A host that dispatches its own route table rather than composing middleware uses
the one-call form instead:

```ts
import { serveWithRequestScope } from '@12-apps/request-scope';

const response = await serveWithRequestScope(request, () => handler(request));
```

---

## Four decisions worth knowing about

### The read and write halves of a cookie ship as one object

`createCookieCodec()` hands back `serialize`, `serializeDeletion` and `parse`
together. The only way a cookie layer can be wrong is by disagreeing with
itself — a parser that percent-decodes paired with a serializer that does not
encode round-trips everything it was tested with and mangles the first value
containing a delimiter. Binding the pair to one object removes the call site
that could import half of it.

### Encoding is a knob, and its default is the safe direction

RFC 6265 forbids `;`, `,`, whitespace and control characters in a value, so
percent-encoding is correct and is the default. But a host adopting this package
already has cookies sitting in browsers, written by whatever it used before.

The two formats meet during a rollout, and only one direction survives:

- a **raw** value read by the **decoding** parser is fine — `decodeURIComponent`
  is the identity on anything with no `%` in it, and a malformed escape falls
  back to the raw text rather than throwing;
- an **encoded** value read by a **raw** parser is not, and that reader is the
  host's old deployed code, which this package cannot reach.

So `createCookieCodec({ encode: false })` exists for hosts with existing raw
cookies, and the flag flips once nothing parses those cookies by hand.

### `requireRequestScope()` throws, deliberately

Code reading an optional credential — a bearer header, an impersonation cookie
— wraps the accessor in a `try` and treats a throw as *"there is no incoming
request, so there is no credential"*. Returning `undefined` would collapse that
into the same answer as *"a request with no such cookie"*, and those need
different handling: one is a background job, the other is an anonymous visitor.

`currentRequestScope()` is the non-throwing form, for code that legitimately
runs both inside and outside a request.

### A redirect gets rebuilt rather than forbidden

`Response.redirect()` is specified to return an **immutable** header list, so
appending a `Set-Cookie` to it throws. Redirecting while clearing a cookie is
completely ordinary (an OAuth callback dropping its state cookie), so rather
than ban the built-in — a rule the next handler rediscovers as a 500 —
`applyResponseCookies` rebuilds the response when its headers refuse the write.

`redirectResponse()` is the other half: a redirect built through the constructor,
so its headers stay mutable. It defaults to **307**, not the 302
`Response.redirect()` gives, because 307 preserves the method — a redirect added
to a non-GET handler later behaves as written instead of silently downgrading
the follow-up to a GET and losing the body.

---

## The Hono adapter and `c.res`

Worth surfacing, because it is invisible until it bites. Hono's `c.res` **setter**
re-merges headers from the previous response, and its `set-cookie` branch reads:

```js
const cookies = this.#res.headers.getSetCookie();  // the OLD list
_res.headers.delete('set-cookie');                 // wipes the NEW list
for (const cookie of cookies) _res.headers.append('set-cookie', cookie);
```

So merging by assignment would **drop** the cookies this middleware queued —
precisely and only when the handler wrote one of its own, which is the case
where both must survive. The adapter appends in place instead, and falls back to
assignment only for an immutable response, which by construction cannot be
carrying a `Set-Cookie` of its own. Both halves are pinned by tests.

## Mount order

Mount the middleware **before** anything that reads a cookie or header
ambiently. A route registered above it runs outside the scope and its accessors
throw — which is the intended failure: loud, at the first request, rather than a
silently absent session.

## Coexisting with another `AsyncLocalStorage`

This store is kept on `globalThis` so a dev server that re-evaluates the module
cannot create a second one invisible to closures captured against the first. The
key it lives under is configurable, for the same reason `@12-apps/audit` makes
its actor-store key configurable: a host that already has an in-house
request-scope module, with call sites importing it, needs both modules on one
store.

```ts
import { declareRequestScopeKey } from '@12-apps/request-scope';

declareRequestScopeKey('__myHostRequestStore'); // at wiring time, once
```

Two stores that disagree do not fail loudly — the accessors read a store nothing
ever entered and throw "outside a request scope" from inside a perfectly
ordinary request. Calling this after a store exists is refused rather than
silently honoured.

Note that the actor context in `@12-apps/audit` is a **different** scope with a
different lifetime: it carries *who is acting*, this one carries *what arrived*.
They are opened by the same adapter and otherwise have nothing to say to each
other.

---

See [`ADOPTING.md`](./ADOPTING.md) for the integration playbook.
