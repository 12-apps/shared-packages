# Adopting `@12-apps/impersonation`

Nine steps. Five are config, two are a mount, and the **last two are the ones
that decide whether the feature is safe** — they are the host's alone, because
they need your permission engine.

## 1. Decide the cookie, the cipher and the time box

```ts
import { createApiImpersonation } from '@12-apps/impersonation/server';

const impersonation = createApiImpersonation({
  cookieName: 'acme_impersonation',
  secure: process.env.NODE_ENV === 'production',
  codec: { encrypt: sealSecret, decrypt: openSecret },
  timeBox: { operator: 30 * 60 * 1000, preview: 10 * 60 * 1000 },
  // …
});
```

The codec must be AUTHENTICATED — its tag is the integrity check, and a payload
that was edited, truncated or minted under a different key has to fail to
decrypt. Whatever you already use to round-trip values that must come back
untampered is the right thing to pass. Rotating its key ends every live session,
which is the correct failure mode for a thing whose whole point is a hard time
box.

There is no default time box. How long a person may wear somebody else's account
is a policy every product has to state out loud.

## 2. Write the four path tables

```ts
paths: {
  money: [/^\/api\/(cart|checkout)(\/|$)/, /^\/api\/tenants\/[^/]+\/billing(\/|$)/],
  moneyReads: [/^\/api\/cart\/[^/]+$/, /^\/api\/tenants\/[^/]+\/billing$/],
  account: [/^\/api\/account(\/|$)/],
  session: [/^\/api\/impersonation$/, /^\/api\/admin\/[^/]+\/impersonation$/],
},
```

- `money` — SUBTREES, never individual verbs, so the next refund route added
  beside one is covered on the day it is written. Provider webhooks belong out:
  they carry no browser cookie.
- `moneyReads` — anchored with `$`, so an entry allowlists ONE route and never
  its children. That anchor is the entire safety of the inversion; keep it.
- `account` — prefixes holding a PERSON's own record. Writes refused for every
  kind, reads allowed.
- `session` — where you mount step 6. Without them the guard refuses the way out.

Read the README's "inversion" section before adding to `moneyReads`.

## 3. Implement the directory

Four lookups, plus a membership test. If your product has more than one
representation of platform authority (an env allowlist AND a role grant, say),
`resolveTarget` must consult ALL of them — checking one leaves the other as a
lateral move between full-privilege accounts.

## 4. Implement the trail

`started`, `ended` and `refused`. All three are required; there is no no-op
default, because an impersonation nobody can see is the outcome this whole
mechanism exists to prevent.

The package guarantees the ordering and the fencing: a START is written before
the cookie is minted (a failed write means no session), and only `ended` is
fenced (a missing end row is recoverable; a stuck session is not).

## 5. Write your own sentences

`messages` on the server, `labels` on the browser. Every field is required. The
package ships no copy — including no language — so a second product cannot
inherit yours.

## 6. Mount the two routers

```ts
import { impersonationRouter } from '@12-apps/impersonation/hono';

const surface = impersonationRouter({ ...config, resolveActor });

app.route('/api/impersonation', surface.platform);
app.route('/api/admin/:tenantSlug/impersonation', surface.tenant);
```

Two mounts, because they are at genuinely different bases. The platform one is
shared by every app you ship (they all mount the same banner, so they must share
one endpoint) and is deliberately NOT tenant-scoped; the tenant one carries the
slug that names the tenant.

`resolveActor` never returns null: the describe verb is answerable by an
anonymous visitor, because a storefront mounts the banner for shoppers too. 401
in your own middleware, above the mount, if you want one.

## 7. Put the gate in front of every request

```ts
app.use('/api/*', async (c, next) => {
  const cookie = readCookie(c, 'acme_impersonation');
  if (!cookie) return next();                         // the fast path
  const actor = await resolveActor(c);
  await surface.guard.assertAllowed({
    impersonation: surface.readState({ actor, cookieValue: cookie }),
    pathname: new URL(c.req.url).pathname,
    method: c.req.method.toUpperCase(),
  });
  return next();
});
```

BEFORE any body is read, so a blocked route answers the same 403 whatever the
payload looks like and no handler side effect can precede the check. The cookie
test keeps the resolution off the traffic that is not impersonated.

`assertAllowed` throws `ImpersonationRefusedError` (`.code`, `.status = 403`,
`.message` your own copy). Map it explicitly rather than letting it fall into a
generic handler.

## 8. Narrow the impersonated actor — the CEILING and the TENANT BOUND

Neither ships here, and skipping either is silent.

```ts
// wherever you resolve an authorization decision
if (outsideBoundedTenant(state, scope, (s) => s === GLOBAL || isOrgScope(s))) {
  return NOTHING;                       // a session reaches ONE tenant, ever
}
switch (previewCeilingKind(state)) {
  case 'none':  return null;            // an operator IS the target
  case 'role':  return rolePermissions(state.tenantId, state.previewRoleName);
  case 'actor': return engine.getPermissions(state.realUserId, scope);
}
```

…then INTERSECT that ceiling with the set you would otherwise grant. A preview
may only ever narrow.

Two rules for the role case: an unknown or archived role resolves to the EMPTY
set (deny by default, visibly wrong to the operator, rather than a fallback that
grants more than the row says), and resolve the ceiling WITHOUT the caller's
attribute bag, so an omitted attribute drops a permission from the ceiling rather
than adding one. A ceiling that errs is required to err narrow.

And force your platform-admin flag FALSE while a session is in force. That is
what stops an operator keeping their own authority while wearing someone else's
account.

## 9. Wire `stillAuthorized`

```ts
stillAuthorized: (state, actor) =>
  state.kind !== 'operator' || isPlatformOperator(actor.email),
```

An operator session's payload names its target at mint time and depends on
nothing about the actor's live rights, so without this someone removed from your
allowlist keeps acting as the tenant's owner for the rest of the time box — and
there is no other way to end it, because the only exit clears a cookie held by
the one browser nobody can reach any more. The preview kinds degrade on their own
through step 8's ceiling; only the unbounded one needs this.

Answering `false` makes the session stop existing for every reader at once — the
routes, the banner, the nesting refusal and the end audit all resolve through the
same reader, so none of them can disagree.

## And on the browser

```ts
const { banner, dialog, startPreview } = createWebImpersonation({
  platformPath: '/api/impersonation',
  tenantPath: (slug) => `/api/admin/${slug}/impersonation`,
  labels,
  onEnd: () => queryClient.clear(),
  dialog: { apps, writableApps, reasonLength, loadTenants, landingUrl },
});
```

Mount `banner` ONCE per app, in the chrome, never per page. It renders nothing
when there is no session but must stay mounted: the start handshake refuses to
begin a session in a document with no banner host, and its paint is the proof
that the session became visible.

`onEnd` is where you drop your query cache — every cached response now belongs to
somebody else. It must be a CLEAR, not an invalidation: invalidation refetches
only what is mounted and leaves the rest readable as the subject.

`startPreview` is for your own "view as" picker. The picker is yours (its roles
and its people are your catalogs); the start goes through the package so the
banner handshake holds for both entry points.

## The journeys

```ts
// playwright.config.ts
import {
  impersonationFeatures,
  impersonationFeaturesRoot,
  impersonationSteps,
} from '@12-apps/impersonation/e2e';

defineBddConfig({
  features: [impersonationFeatures],
  featuresRoot: impersonationFeaturesRoot,
  steps: [impersonationSteps, 'tests/e2e/steps/**/*.ts'],
});
```

…then implement `defineImpersonationWorld` from a module inside your own steps
glob. Nothing is copied, so a scenario added upstream runs on your next version
bump.

## Things that will bite

- **`featuresRoot` is not decoration.** Left unset, the compiled specs mirror a
  `node_modules` path that Playwright's default `testIgnore` drops — bddgen
  reports the features compiled and the run passes with the whole suite absent.
- **A machine token may neither inherit nor mint a session.** The package
  enforces both from `actor.isMachineToken`; make sure you set it.
- **Force platform authority OFF while a session is in force.** That is the
  host's job, and it is what stops an operator keeping their own rights while
  wearing someone else's account. The nesting refusal is asked before the
  authority check precisely so a host that does this still gets an honest reason
  in its trail.
