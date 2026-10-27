# @12-apps/forms-core

Framework-free form primitives: field validators, the `Result` type and
`createServerAction`. This page covers only the copy a host supplies.

- **Every fallback is English, and every one takes the host's words.** The
  package has four sentences of its own, and each sits behind an argument.
- **Both languages ship, as named packs.** `EN_US_FORMS_MESSAGES` (the
  sentences the package falls back to) and `PT_BR_FORMS_MESSAGES`, both
  `FormsMessages`; `FORMS_MESSAGES` keys the two by tag, for `localeCopy` from
  `@12-apps/i18n`. Nothing defaults to the pt-BR one.

## Where each sentence plugs in

| `FormsMessages` key | taken by | English default |
|---|---|---|
| `genericError` | `createServerAction(schema, handler, { genericError })` — what an unexpected throw answers with | `Something went wrong. Please try again.` |
| `required` | `required(message)` | `This field is required` |
| `email` | `email(message)` | `Enter a valid email address` |
| `minLength(n)` | `minLength(n, message)` | `Must be at least ${n} characters` |

```ts
import {
  createServerAction,
  email,
  minLength,
  PT_BR_FORMS_MESSAGES as copy,
  required,
} from '@12-apps/forms-core';

const action = createServerAction(
  { email: [required(copy.required), email(copy.email)], password: [minLength(8, copy.minLength(8))] },
  handler,
  { genericError: copy.genericError },
);
```

A thrown `ActionError` is not a fallback: its `message` reaches the user
verbatim, so it is already in the host's words. Anything else thrown is logged
server-side and answered with `genericError`.
