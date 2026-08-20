# Adopting @12-apps/auth

Three halves, one factory each, one config object each.

```ts
// backend
const { handlers, auth, isAdmin } = createApiAuth({ signInGate, sessionAdmin });

// backend, e-mail + password (opt-in)
const credentials = createEmailCredentials({ store, mailer, settings, appUrl });

// frontend
const { SessionProvider, useSession } = createWebAuth();
```

## Migrating 4.x → 5.0 — one entry point per peer

This package shipped **fifteen** entry points; report-builder ships five. Eleven
of ours named a *module* rather than a boundary, so adopting this package meant
learning a map before you could import anything. The root was heavy on top of
that, so the split below is two moves, not one: subpaths fold inward, and the
runtime-bound half folds out to `./server`.

An entry point now marks a distinct **peer**, which is the rule report-builder
already follows: `./react` needs react, `./hono` needs hono, `./e2e` needs
playwright, `./notifications` needs `@12-apps/notifications`, and `.` needs none
of them.

### Removed exports, and what replaces each

| Removed | Replacement |
|---|---|
| `@12-apps/auth/config` | `@12-apps/auth` — same symbols (`authConfig`, `setSignInGate`, `setSessionAdminResolver`, `ExtendedSession`). Had no consumer anywhere. |
| `@12-apps/auth/admin` | `@12-apps/auth` — `isAdminEmail`, `parseAdminEmails`. |
| `@12-apps/auth/device-detection` | `@12-apps/auth` — `detectAppleDevice`, `DeviceInfo`. |
| `@12-apps/auth/password` | `@12-apps/auth` — the policy helpers and `PasswordPolicy`. Had no consumer anywhere. |
| `@12-apps/auth/tokens` | `@12-apps/auth` — `hashToken`, `issueToken`, `buildTokenLink`, `isTokenExpired`, `DEFAULT_TOKEN_TTL_MS`, `IssuedToken`, `IssueTokenOptions`. Had no consumer anywhere. |
| `@12-apps/auth/email-credentials` | `@12-apps/auth` — `createEmailCredentials` and its types. |
| `@12-apps/auth/react/screens` | `@12-apps/auth/react` — `createEmailAuthScreens`, `PT_BR`, `failureMessage`. |
| `@12-apps/auth/react/settings` | `@12-apps/auth/react` — `createEmailAuthSettingsScreen`, `PT_BR_SETTINGS`. |
| `@12-apps/auth/react/pages` | `@12-apps/auth/react` — `createAuthPages`, `PT_BR_PAGES`. |
| `@12-apps/auth/prisma` | `@12-apps/auth/server` — `createPrismaEmailCredentialsStore`, `createAuthSettingsStore`, `AuthDb`, `AuthSettingsDb`, `EmailIdentityDelegate`. This is where report-builder keeps `SavedReportDb`: a seam over a duck-typed client, not a dependency on a generated one. |

Unchanged: `.`, `./server`, `./react`, `./hono`, `./e2e`, `./notifications`.

### The root is now the LIGHT half — the bridge moved with it

Collapsing the subpaths would have made `.` expensive: it value-imported
`@auth/core` and applied the `AUTH_*` environment defaults as a module side
effect, so `import { hashToken }` loaded the whole framework and mutated config
from the environment. That is the opposite of report-builder, whose `.` is the
pure spec engine and whose `./server` is the runtime-bound half.

So the Auth.js bridge moved too:

| Also moved to `/server` | Why |
|---|---|
| `createApiAuth`, `ApiAuth`, `ApiAuthConfig` | the sanctioned adoption factory — exactly where report-builder keeps `createReportBuilder` |
| `auth`, `authHandler`, `handlers`, `authConfig` | the Auth.js runtime, plus the `setEnvDefaults` side effect |
| `credentialsProvider`, `CredentialsProviderConfig` | value-imports `@auth/core` |
| `setSignInGate`, `setSessionAdminResolver`, `ExtendedSession`, `SignInGate`, `SessionAdminResolver` | the config they mutate is the Auth.js one |
| `AuthConfig`, `DefaultSession`, `Session`, `User` | re-exported `@auth/core` types |

**`CREDENTIALS_PROVIDER_ID` deliberately stays on the root.** A browser
comparing `session.provider` needs that string and must not pull `@auth/core`
in to get it, which is why the id has always had its own module.

What `.` still gives you, with no peer at all: `createEmailCredentials` and its
types, the password policy and hashing, the token primitives, the admin
allowlist, `createInProcessRateLimiter`, and device detection.

`src/__tests__/light-root.test.ts` walks the root's import graph and fails if
anything in it ever reaches `@auth/core`, react, react-dom, hono or playwright
again — and fails the other way too, if the bridge stops being reachable from
`./server`, so the guard cannot be satisfied by deleting it.

## The one thing to know first

**This package owns no database tables.**

The session strategy is `jwt` with **no adapter**, so there are no
`User` / `Account` / `Session` rows, no Prisma partial to sync, and nothing to
migrate. The obvious assumption — "auth owns the user table" — is wrong here,
and acting on it would have you adopting migrations for tables nothing writes.

Your user record is *yours*. It is created by whatever your
{@link signInGate} does when it decides a sign-in is allowed. The package
decides **whether** someone may sign in and **what ends up in the token**;
everything about who they are in your domain stays with you.

## Backend

```ts
import { createApiAuth } from "@12-apps/auth";

const { handlers, auth, isAdmin } = createApiAuth({
  // REQUIRED in practice. With no gate every sign-in is refused — it fails
  // closed on purpose, so forgetting it gives you no sessions rather than open
  // registration.
  signInGate: async ({ email, name, image, provider }) => {
    const user = await findUserByEmail(email);
    return Boolean(user?.acceptedTermsAt);
  },

  // Optional. Decides `session.user.isSuperadmin` at sign-in. Pass the SAME
  // resolver your server-side gate uses, or the session claim and the gate can
  // disagree. Defaults to the `adminEmails` allowlist.
  sessionAdmin: (email) => isPlatformOwner(email),

  // Optional. Defaults to ADMIN_EMAILS. String or array.
  adminEmails: process.env.ADMIN_EMAILS,
});

export const { GET, POST } = handlers;
```

| Config | Default | Notes |
|---|---|---|
| `secret` | `AUTH_SECRET` | session encryption |
| `authUrl` | `AUTH_URL` | the **public** origin, not the internal one — see below |
| `basePath` | `AUTH_URL`'s pathname, else `/api/auth` | see below |
| `providers` | whatever the `*_CLIENT_ID`/`*_CLIENT_SECRET` pairs configure | Google, Facebook, Apple |
| `adminEmails` | `ADMIN_EMAILS` | comma-separated, or an array |
| `signInGate` | none → **refuse everything** | |
| `sessionAdmin` | the allowlist | |
| `signInPage` | `/login` | |
| `maxAge` | 30 days | seconds |

### Two settings that bite

**`authUrl` must be the public origin.** Behind a reverse proxy the app is
reached internally as `web:3000`, so the URL Auth.js would otherwise see is not
the one the browser used — and it derives the OAuth `redirect_uri` and the
cookie attributes from it. Without this, a user returning from the provider
lands on `http://web:3000`.

**`basePath` defaults to `/api/auth`, not Auth.js core's `/auth`.** Every OAuth
redirect URI already registered with Google, Facebook and Apple points at
`/api/auth`. Taking core's default silently invalidates all of them.

## Frontend

```tsx
import { createWebAuth } from "@12-apps/auth/react";

// Must match the backend's basePath.
const { SessionProvider, useSession } = createWebAuth();

function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}

function SignInButton() {
  const { signIn, status } = useSession();
  return (
    <button disabled={status === "loading"} onClick={() => signIn("google")}>
      Continue with Google
    </button>
  );
}
```

`signIn` **rejects** if the CSRF token cannot be fetched, so a caller that set a
loading state before calling can clear it and surface the failure rather than
leaving the button stuck.

### Why sign-in is a form POST and not a link

Auth.js v5 answers a GET to `signin/:provider` with an `UnknownAction` →
`302 ?error=Configuration`, which reaches the user as "the provider did not
respond". The token has to be fetched and a hidden form submitted so the browser
performs a top-level navigation that follows the 302 to the provider.

### The callback URL is validated

`//host` — and its `/\host` backslash variant — are **not** paths: browsers
resolve them as protocol-relative external URLs, so a `startsWith("/")` check is
an open redirect. Anything not provably same-origin falls back to the current
page.

## Migrating from the legacy surface

The module-global surface still works and delegates to the same builder, so
there is no behaviour difference and you can move one host at a time:

```diff
-setSignInGate(signInGate);
-setSessionAdminResolver(isSuperadmin);
-export const { GET, POST } = handlers;
+const { handlers } = createApiAuth({ signInGate, sessionAdmin: isSuperadmin });
+export const { GET, POST } = handlers;
```

Prefer the factory in new code: the setters are mutable module state any
importer can overwrite, with an ordering constraint nothing enforces — install a
gate after the first request and every sign-in before it failed closed.

## E-mail and password

A third factory, same shape. It is **opt-in**: without `emailPassword` on
`createApiAuth` no credentials provider is registered, `callback/credentials`
404s, and nothing below exists.

```ts
import { createApiAuth, createEmailCredentials } from "@12-apps/auth";

const credentials = createEmailCredentials({
  store,     // your database, behind ~10 one-statement methods
  mailer,    // your copy, in your language
  settings,  // { enabled, requireEmailVerification } — read fresh on every call
  appUrl: process.env.AUTH_URL,
});

const { handlers } = createApiAuth({
  signInGate,
  emailPassword: { authenticate: credentials.authenticate },
});
```

The credentials provider is **appended** to the OAuth ones, never a
replacement. That is what lets one account carry both, which is the point: a
person who signed up with Google can add a password later and afterwards use
either.

### It owns its tables now

This used to say the opposite, and the change is the point of the 5.0 release.

`prisma/auth.prisma` owns `auth_credentials`, `auth_tokens` and
`auth_platform_settings`, with migrations beside them. Adopt them the way you
adopt report-builder's:

```bash
pnpm --filter @12-apps/auth prisma:sync   # copy the partial into your schema folder
# then your own plugin-migration sweep, which finds prisma/migrations here
```

The partial is **COPIED, never symlinked** — `npm pack` drops symlinked
entries, `turbo prune` dangles a link whose owner is not a declared dependency,
and Prisma `lstat`s a migration directory, so a symlinked one is silently
skipped: a green deploy that applied no schema.

Every user reference is an opaque `user_id` with **no foreign key into any host
table**, so these migrations apply in a repo whose users live under another
name, in another database, or not yet at all. That constraint is why the
credential columns are a table rather than columns on your `users`: a package
cannot add columns to a model it does not own.

**You still supply one thing** — who your users are. `EmailIdentityDelegate` is
three methods (`findByEmail`, `findById`, `upsert`) over your own user table.
Hand it to `createPrismaEmailCredentialsStore` from `./server` and the
credential rows, the tokens and the switches are handled here.

If you'd rather implement the store yourself, the seam is unchanged and the one
thing this package insists on still holds: `consumeToken` must be a CONDITIONAL
write (`UPDATE … WHERE consumed_at IS NULL`) that reports whether it affected a
row. That return value *is* the single-use guarantee — two clicks of one link
race, both read an unconsumed row, and a fake that just stamps the field lets
both through.

### The flows

| Call | For |
|---|---|
| `signUp` | create an account with a password |
| `verifyEmail` / `resendVerification` | prove the address |
| `requestPasswordReset` / `resetPassword` | "I forgot my password" |
| `setPassword` | signed in: change one, **or add the first one to a Google account** |
| `hasPassword` | which of those two the security screen should offer |
| `authenticate` | check credentials at sign-in |

Nothing throws for an ordinary refusal. Every call returns
`{ ok: false, reason }` from a closed vocabulary (`EmailAuthFailure`), so the
host maps codes to its own status codes and its own copy.

### Three decisions that are not obvious

**`requireEmailVerification` changes the sign-up CONTRACT, not just security.**
On, sign-up is non-enumerating: a taken address and a free one return the
identical value, and only the inbox learns the difference. Off, a new account
can sign in immediately — so sign-up has to be able to say `email-taken`. The
switch is choosing which of those two you want, and it is worth knowing that is
what it is choosing.

**Failing fast is the bug.** `authenticate` burns a real scrypt derivation on an
unknown address and on an account that only ever used Google, so that "no such
user" and "wrong password" take the same time. Skipping that work is the
intuitive optimisation and it turns response time into a directory of who has an
account.

**`resetPassword` marks the address verified.** Clicking a link delivered to an
inbox proves control of it exactly as a verification link does. Without this, an
unverified account that resets its password lands in a dead end: right password,
still refused.

### Browser

```tsx
import { createEmailAuth, createWebAuth, useAuthAction } from "@12-apps/auth/react";

const { useSession } = createWebAuth();
const emailAuth = createEmailAuth();          // POSTs to /api/auth/email/**

const { signInWithPassword } = useSession();  // resolves, never throws on a refusal
const forgot = useAuthAction(emailAuth.requestPasswordReset);
```

`signInWithPassword` does **not** navigate. The social flow has to — the browser
leaves for the provider and comes back — but a password answer is available on
the first response, and navigating anyway throws away the form and the error
with it. It posts with `X-Auth-Return-Redirect`, so Auth.js answers
`200 { url }` (setting the session cookie all the same) and the page reads the
outcome off that URL instead of following it.

Your six endpoints must answer `2xx { data }` on success and non-2xx
`{ error, reason }` on refusal, where `reason` is an `EmailAuthFailure`. That
code is what lets a screen say "that link has expired" instead of "something
went wrong" while the sentence itself stays in your language.
