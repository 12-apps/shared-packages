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

### It still owns no tables

Same as the rest of the package. `store` is ~10 methods over rows you define,
and the only thing this package insists on is that `consumeToken` be a
CONDITIONAL write (`UPDATE … WHERE consumed_at IS NULL`) that reports whether
it affected a row. That return value *is* the single-use guarantee — two clicks
of one link race, both read an unconsumed row, and a fake that just stamps the
field lets both through.

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
